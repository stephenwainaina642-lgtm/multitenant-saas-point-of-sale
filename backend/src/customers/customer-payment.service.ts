import prisma from "../lib/prisma.js";
import { AppError } from "../lib/errors.js";
import { checkedPaymentReference, isMpesaClash, MPESA_CLASH_MESSAGE } from "../lib/mpesa.js";
import { requirePublicId } from "../lib/public-id.js";
import { centsToString, decimalToCents, parseMoney } from "../lib/money.js";

type Actor = { userId: string; onlyOwnSales: boolean };
type UnpaidRow = { id: bigint; public_id: string; receipt_number: string; sale_date: Date; total: string; balance_due: string };

async function unpaidSales(tx: Pick<typeof prisma, "$queryRaw">, businessId: bigint, customerId: bigint, actor: Actor, lock: boolean) {
  // Oldest first, so a payment always clears the oldest debt first.
  const own = actor.onlyOwnSales ? BigInt(actor.userId) : null;
  const rows = lock
    ? await tx.$queryRaw<UnpaidRow[]>`
        select id, public_id::text as public_id, receipt_number, sale_date, total::text, balance_due::text from sales
         where business_id = ${businessId} and customer_id = ${customerId} and status = 'completed' and balance_due > 0
           and (${own}::bigint is null or salesperson_id = ${own}::bigint)
         order by sale_date asc, id asc for update`
    : await tx.$queryRaw<UnpaidRow[]>`
        select id, public_id::text as public_id, receipt_number, sale_date, total::text, balance_due::text from sales
         where business_id = ${businessId} and customer_id = ${customerId} and status = 'completed' and balance_due > 0
           and (${own}::bigint is null or salesperson_id = ${own}::bigint)
         order by sale_date asc, id asc`;
  return rows;
}

async function customerOf(businessId: bigint, idText: string) {
  const publicId = requirePublicId(idText, "Invalid customer id");
  const c = await prisma.customer.findFirst({ where: { publicId, businessId } });
  if (!c) throw new AppError(404, "Customer not found");
  return c;
}

export async function customerUnpaidSales(businessId: string, idText: string, actor: Actor) {
  const biz = BigInt(businessId);
  const c = await customerOf(biz, idText);
  const rows = await unpaidSales(prisma, biz, c.id, actor, false);
  const owed = rows.reduce((s, r) => s + decimalToCents(r.balance_due), 0n);
  return {
    customer: { id: c.publicId, name: c.name },
    totalOwed: centsToString(owed),
    sales: rows.map((r) => ({ id: r.public_id, receiptNumber: r.receipt_number, saleDate: r.sale_date, total: r.total, balanceDue: r.balance_due })),
  };
}

type Body = { amount?: unknown; method?: unknown; reference?: unknown; notes?: unknown };

/**
 * Receives one payment from a customer and spreads it over their unpaid sales, oldest first.
 * Everything happens in one transaction: either every sale and the customer's balance are updated, or nothing is.
 */
export async function receiveCustomerPayment(businessId: string, idText: string, actor: Actor, body: Body, idempotencyKey?: string) {
  const biz = BigInt(businessId);
  const amount = parseMoney(body.amount, "Payment amount");
  if (amount <= 0n) throw new AppError(400, "Payment amount must be greater than zero");
  const method = typeof body.method === "string" ? body.method.trim().toLowerCase() : "";
  if (!method) throw new AppError(400, "Payment method is required");
  const key = idempotencyKey?.trim() || null;
  if (key && key.length > 80) throw new AppError(400, "Idempotency-Key must not exceed 80 characters");
  const notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 500) : "";
  const customer = await customerOf(biz, idText);

  try {
    return await prisma.$transaction(async (tx) => {
      if (key) {
        // The same request sent twice (double click, dropped connection) must not take the money twice.
        const earlier = await tx.payment.findMany({ where: { businessId: biz, idempotencyKey: { startsWith: `${key}#` } }, include: { sale: true }, orderBy: { id: "asc" } });
        if (earlier.length > 0) {
          if (earlier[0]!.sale.customerId !== customer.id) throw new AppError(409, "This Idempotency-Key was already used for a different customer");
          return result(tx, customer, earlier.map((p) => ({ saleId: p.sale.publicId, receiptNumber: p.sale.receiptNumber, paid: decimalToCents(p.amount), balanceAfter: decimalToCents(p.sale.balanceDue), status: p.sale.paymentStatus })), true);
        }
      }

      await tx.$queryRaw`select id from customers where id = ${customer.id} and business_id = ${biz} for update`;
      const rows = await unpaidSales(tx, biz, customer.id, actor, true);
      const owed = rows.reduce((s, r) => s + decimalToCents(r.balance_due), 0n);
      if (owed === 0n) throw new AppError(409, "This customer has no unpaid sales");
      if (amount > owed) throw new AppError(400, `Payment cannot exceed the amount owed (${centsToString(owed)})`);

      const reference = await checkedPaymentReference(tx, biz, method, body.reference);
      let left = amount;
      const allocations: Alloc[] = [];
      for (const row of rows) {
        if (left === 0n) break;
        const due = decimalToCents(row.balance_due);
        const pay = left < due ? left : due;
        const first = allocations.length === 0;
        const sale = await tx.sale.findUniqueOrThrow({ where: { id: row.id } });
        const newPaid = decimalToCents(sale.amountPaid) + pay;
        const newDue = decimalToCents(sale.total) - newPaid;
        await tx.payment.create({
          data: {
            businessId: biz, saleId: row.id, amount: centsToString(pay), method,
            // A reference (e.g. an M-Pesa code) can be stored only once, so it sits on the first part; the others point to it.
            reference: first ? reference : null,
            notes: [`Account payment of ${centsToString(amount)}${reference && !first ? ` (ref ${reference})` : ""}`, notes].filter(Boolean).join(" - "),
            idempotencyKey: key ? `${key}#${row.id}` : null,
            createdBy: BigInt(actor.userId),
          },
        });
        const updated = await tx.sale.update({
          where: { id: row.id },
          data: { amountPaid: centsToString(newPaid), balanceDue: centsToString(newDue), paymentStatus: newDue === 0n ? "paid" : "partial" },
        });
        allocations.push({ saleId: row.id, salePublicId: row.public_id, receiptNumber: row.receipt_number, paid: pay, balanceAfter: newDue, status: updated.paymentStatus });
        left -= pay;
      }
      // Same rule as a single-sale payment: the running balance never goes below zero.
      await tx.$executeRaw`
        update customers set balance = greatest(balance - ${centsToString(amount)}::numeric, 0), updated_at = now()
         where id = ${customer.id} and business_id = ${biz}`;
      await tx.auditLog.create({
        data: { businessId: biz, userId: BigInt(actor.userId), action: "customer.payment", entity: "customer", entityId: customer.id, details: { amount: centsToString(amount), method, sales: allocations.map((a) => a.receiptNumber) } },
      });
      return result(tx, customer, allocations, false);
    });
  } catch (error) {
    if (isMpesaClash(error)) throw new AppError(409, MPESA_CLASH_MESSAGE);
    throw error;
  }
}

type Alloc = { saleId: bigint | string; salePublicId?: string; receiptNumber: string; paid: bigint; balanceAfter: bigint; status: string };

async function result(db: Pick<typeof prisma, "customer">, customer: { id: bigint; publicId: string; name: string }, allocations: Alloc[], replay: boolean) {
  // Read through the same transaction, so the balance returned is the one just written.
  const fresh = await db.customer.findUnique({ where: { id: customer.id } });
  const total = allocations.reduce((s, a) => s + a.paid, 0n);
  return {
    customer: { id: customer.publicId, name: customer.name, balance: centsToString(decimalToCents(fresh?.balance ?? 0)) },
    amount: centsToString(total),
    idempotentReplay: replay,
    allocations: allocations.map((a) => ({ saleId: a.salePublicId ?? String(a.saleId), receiptNumber: a.receiptNumber, paid: centsToString(a.paid), balanceAfter: centsToString(a.balanceAfter), status: a.status })),
  };
}
