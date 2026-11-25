import prisma from "../lib/prisma.js";
import { AppError } from "../lib/errors.js";
import { requirePublicId } from "../lib/public-id.js";
import { checkedPaymentReference, isMpesaClash, MPESA_CLASH_MESSAGE } from "../lib/mpesa.js";
import { Prisma } from "../generated/prisma/client.js";
import { centsToString, decimalToCents, parseMoney } from "../lib/money.js";

/**
 * Guest stays and room accounts.
 *
 * The guest is an ordinary customer, and a charge to the room is an ordinary unpaid sale on that customer, so the
 * existing credit ledger (customers.balance, sales.balance_due) stays the single source of truth. A stay only adds the
 * room, the dates, an optional per-stay credit limit and an optional deposit, and links the sales charged to it.
 * Check-out settles the stay's sales in one transaction: it will not complete until the account is paid in full.
 */

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
type Db = Pick<typeof prisma, "$queryRaw">;

const text = (v: unknown, max: number, label: string, required = false) => {
  const t = String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim();
  if (required && !t) throw new AppError(400, `${label} is required`);
  if (t.length > max) throw new AppError(400, `${label} must be at most ${max} characters`);
  return t || null;
};

const methodOf = (v: unknown, label = "Payment method") => {
  const m = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (!m) throw new AppError(400, `${label} is required`);
  if (m.length > 30) throw new AppError(400, `${label} must be at most 30 characters`);
  if (m === "deposit" || m === "credit") throw new AppError(400, `"${m}" cannot be used as a ${label.toLowerCase()} here`);
  return m;
};

const isRoomClash = (e: unknown) => {
  const x = e as { code?: string; message?: string; meta?: unknown };
  return !!x && (x.code === "P2002" || x.code === "23505" || String(x.message ?? "").includes("hotel_stays_one_in_house_per_room")) && JSON.stringify(x.meta ?? x.message ?? "").includes("hotel_stays_one_in_house_per_room");
};

type StayRow = Awaited<ReturnType<typeof loadStay>>;

async function loadStay(businessId: bigint, idText: string) {
  const publicId = requirePublicId(idText, "Invalid stay id");
  const stay = await prisma.hotelStay.findFirst({ where: { publicId, businessId }, include: { customer: true } });
  if (!stay) throw new AppError(404, "Stay not found");
  return stay;
}

type FolioSale = { id: bigint; public_id: string; receipt_number: string; sale_date: Date; total: string; amount_paid: string; balance_due: string; notes: string | null };

async function staySales(db: Db, stayId: bigint): Promise<FolioSale[]> {
  return db.$queryRaw<FolioSale[]>`
    select s.id, s.public_id::text as public_id, s.receipt_number, s.sale_date, s.total::text, s.amount_paid::text, s.balance_due::text, s.notes
      from hotel_stay_sales l join sales s on s.id = l.sale_id
     where l.stay_id = ${stayId} and s.status = 'completed'
     order by s.sale_date asc, s.id asc`;
}

function format(stay: StayRow, sales: FolioSale[]) {
  const charged = sales.reduce((s, r) => s + decimalToCents(r.total), 0n);
  const paid = sales.reduce((s, r) => s + decimalToCents(r.amount_paid), 0n);
  const owed = sales.reduce((s, r) => s + decimalToCents(r.balance_due), 0n);
  const limit = decimalToCents(stay.creditLimit);
  const deposit = decimalToCents(stay.depositAmount);
  const available = deposit - decimalToCents(stay.depositApplied) - decimalToCents(stay.depositRefunded);
  return {
    id: stay.publicId,
    roomName: stay.roomName,
    status: stay.status,
    guest: { id: stay.customer.publicId, name: stay.customer.name, phone: stay.customer.phone, email: stay.customer.email },
    creditLimit: centsToString(limit),
    notes: stay.notes,
    checkedInAt: stay.checkedInAt,
    checkedOutAt: stay.checkedOutAt,
    deposit: {
      amount: centsToString(deposit), method: stay.depositMethod, reference: stay.depositReference,
      applied: centsToString(decimalToCents(stay.depositApplied)), refunded: centsToString(decimalToCents(stay.depositRefunded)), available: centsToString(available),
      refundMethod: stay.refundMethod, refundReference: stay.refundReference,
    },
    charges: sales.map((r) => ({
      id: r.public_id, receiptNumber: r.receipt_number, saleDate: r.sale_date, notes: r.notes,
      total: r.total, paid: r.amount_paid, balanceDue: r.balance_due,
    })),
    totals: {
      charged: centsToString(charged), paid: centsToString(paid), owed: centsToString(owed),
      // null = no limit on this stay
      creditHeadroom: limit > 0n ? centsToString(limit > owed ? limit - owed : 0n) : null,
      // What the guest still has to pay at check-out once the deposit is used.
      dueAtCheckout: centsToString(owed > available ? owed - available : 0n),
      depositToRefund: centsToString(available > owed ? available - owed : 0n),
    },
  };
}

async function folio(businessId: bigint, idText: string) {
  const stay = await loadStay(businessId, idText);
  return format(stay, await staySales(prisma, stay.id));
}

export const getStay = folio;

export async function listStays(businessId: bigint, query: { status?: unknown }) {
  const status = query.status === "checked_out" ? "checked_out" : query.status === "all" ? undefined : "in_house";
  const rows = await prisma.hotelStay.findMany({
    where: { businessId, ...(status && { status }) },
    include: { customer: true },
    orderBy: status === "in_house" ? { roomName: "asc" } : { checkedInAt: "desc" },
    take: 200,
  });
  const owed = rows.length
    ? await prisma.$queryRaw<{ stay_id: bigint; owed: string }[]>`
        select l.stay_id, coalesce(sum(s.balance_due), 0)::text as owed
          from hotel_stay_sales l join sales s on s.id = l.sale_id
         where l.stay_id in (${Prisma.join(rows.map((r) => r.id))}) and s.status = 'completed'
         group by l.stay_id`
    : [];
  const byStay = new Map(owed.map((o) => [o.stay_id.toString(), o.owed]));
  return rows.map((s) => ({
    id: s.publicId, roomName: s.roomName, status: s.status, guestName: s.customer.name, guestPhone: s.customer.phone,
    creditLimit: centsToString(decimalToCents(s.creditLimit)), checkedInAt: s.checkedInAt, checkedOutAt: s.checkedOutAt,
    owed: byStay.get(s.id.toString()) ?? "0.00",
  }));
}


type CheckInBody = {
  roomName?: unknown; customerId?: unknown; guestName?: unknown; phone?: unknown; email?: unknown;
  creditLimit?: unknown; notes?: unknown; deposit?: unknown;
};

export async function checkIn(businessId: bigint, userId: bigint, body: CheckInBody) {
  const room = text(body.roomName, 40, "Room", true)!;
  const notes = text(body.notes, 300, "Notes");
  const creditLimit = body.creditLimit === undefined || body.creditLimit === null || body.creditLimit === "" ? 0n : parseMoney(body.creditLimit, "Credit limit");
  if (creditLimit < 0n) throw new AppError(400, "Credit limit cannot be negative");

  let depositCents = 0n;
  let depositMethod: string | null = null;
  let depositReference: string | null = null;
  if (body.deposit !== undefined && body.deposit !== null) {
    const d = body.deposit as { amount?: unknown; method?: unknown; reference?: unknown };
    if (typeof d !== "object") throw new AppError(400, "Deposit is invalid");
    depositCents = parseMoney(d.amount, "Deposit amount");
    if (depositCents < 0n) throw new AppError(400, "Deposit cannot be negative");
    if (depositCents > 0n) depositMethod = methodOf(d.method, "Deposit method");
  }

  try {
    const stay = await prisma.$transaction(async (tx) => {
      let customerId: bigint;
      if (body.customerId) {
        const publicId = requirePublicId(String(body.customerId), "Invalid guest");
        const c = await tx.customer.findFirst({ where: { publicId, businessId } });
        if (!c) throw new AppError(404, "Guest (customer) not found");
        if (!c.isActive) throw new AppError(409, "This customer is archived");
        customerId = c.id;
      } else {
        const name = text(body.guestName, 255, "Guest name", true)!;
        const c = await tx.customer.create({ data: { businessId, name, phone: text(body.phone, 50, "Phone"), email: text(body.email, 255, "Email") } });
        customerId = c.id;
      }
      if (depositCents > 0n) {
        // Same rule as any payment: an M-Pesa code can be recorded once.
        depositReference = await checkedPaymentReference(tx, businessId, depositMethod!, (body.deposit as { reference?: unknown }).reference);
      }
      const created = await tx.hotelStay.create({
        data: {
          businessId, customerId, roomName: room, creditLimit: centsToString(creditLimit), notes,
          depositAmount: centsToString(depositCents), depositMethod, depositReference, createdBy: userId,
        },
      });
      await tx.auditLog.create({
        data: { businessId, userId, action: "hotel.checkin", entity: "hotel_stay", entityId: created.id, details: { room, deposit: centsToString(depositCents), creditLimit: centsToString(creditLimit) } },
      });
      return created;
    });
    return folio(businessId, stay.publicId);
  } catch (e) {
    if (isRoomClash(e)) throw new AppError(409, `Room ${room} already has a guest checked in`);
    if (isMpesaClash(e)) throw new AppError(409, MPESA_CLASH_MESSAGE);
    throw e;
  }
}

/** Only the stay's own credit limit and notes can change while in house. */
export async function updateStay(businessId: bigint, idText: string, body: { creditLimit?: unknown; notes?: unknown }) {
  const stay = await loadStay(businessId, idText);
  if (stay.status !== "in_house") throw new AppError(409, "This stay is already checked out");
  const data: { creditLimit?: string; notes?: string | null; updatedAt: Date } = { updatedAt: new Date() };
  if (body.creditLimit !== undefined) {
    const c = parseMoney(body.creditLimit, "Credit limit");
    if (c < 0n) throw new AppError(400, "Credit limit cannot be negative");
    data.creditLimit = centsToString(c);
  }
  if (body.notes !== undefined) data.notes = text(body.notes, 300, "Notes");
  await prisma.hotelStay.update({ where: { id: stay.id }, data });
  return folio(businessId, idText);
}

// ---------- charging a table bill to a room (used by hotel.service billOrder) ----------

/** One bill at a time per stay, so two tills cannot both pass the credit-limit check and together exceed it. */
export function withStayLock<T>(stayId: bigint, fn: () => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    // Two-key form, so it can never collide with the one-key order lock.
    await tx.$executeRaw`select pg_advisory_xact_lock(2, ${Number(stayId % 2147483647n)}::int)`;
    return fn();
  }, { timeout: 60_000, maxWait: 15_000 });
}

export async function stayInternalId(businessId: bigint, idText: string) {
  return (await loadStay(businessId, idText)).id;
}

/** The in-house stay a bill may be charged to, plus how much is already owed on it. */
export async function stayForCharge(businessId: bigint, idText: string) {
  const stay = await loadStay(businessId, idText);
  if (stay.status !== "in_house") throw new AppError(409, `Room ${stay.roomName} is checked out. Choose a guest who is in house.`);
  const sales = await staySales(prisma, stay.id);
  const owed = sales.reduce((s, r) => s + decimalToCents(r.balance_due), 0n);
  return { stay, owed, limit: decimalToCents(stay.creditLimit) };
}

export function assertWithinStayLimit(stay: { roomName: string }, owed: bigint, limit: bigint, adding: bigint) {
  if (limit > 0n && owed + adding > limit) {
    const room = limit > owed ? limit - owed : 0n;
    throw new AppError(400, `Room ${stay.roomName} credit limit exceeded. Limit ${centsToString(limit)}, already charged ${centsToString(owed)}, this bill ${centsToString(adding)} (room left: ${centsToString(room)}).`);
  }
}

export async function linkSale(stayId: bigint, saleId: bigint) {
  await prisma.$executeRaw`insert into hotel_stay_sales(stay_id, sale_id) values (${stayId}, ${saleId}) on conflict (sale_id) do nothing`;
}

// ---------- check-out ----------

type PayPart = { method: string; amount: bigint; reference: unknown };
type DueRow = { id: bigint; receipt_number: string; due: bigint; total: bigint; paid: bigint };

export async function checkOut(
  businessId: bigint, userId: bigint, idText: string,
  body: { payments?: unknown; refundMethod?: unknown; refundReference?: unknown; notes?: unknown },
) {
  const first = await loadStay(businessId, idText);
  // A repeat of a completed check-out (double click, dropped connection) just shows the finished folio.
  if (first.status === "checked_out") return { ...(await folio(businessId, idText)), alreadyCheckedOut: true };

  const rawParts = body.payments === undefined ? [] : body.payments;
  if (!Array.isArray(rawParts) || rawParts.length > 10) throw new AppError(400, "Payments must be a list of at most 10 parts");
  const parts: PayPart[] = rawParts.map((p, i) => {
    const x = (p ?? {}) as { method?: unknown; amount?: unknown; reference?: unknown };
    const amount = parseMoney(x.amount, `Payment ${i + 1} amount`);
    if (amount <= 0n) throw new AppError(400, `Payment ${i + 1} amount must be greater than zero`);
    return { method: methodOf(x.method), amount, reference: x.reference };
  });
  const notes = text(body.notes, 300, "Notes");

  try {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`select id from customers where id = ${first.customerId} and business_id = ${businessId} for update`;
      const locked = await tx.$queryRaw<{ status: string }[]>`select status from hotel_stays where id = ${first.id} for update`;
      if (locked[0]?.status !== "in_house") throw new AppError(409, "This stay was just checked out by someone else");

      const raw = await tx.$queryRaw<{ id: bigint; receipt_number: string; total: string; amount_paid: string; balance_due: string }[]>`
        select s.id, s.receipt_number, s.total::text, s.amount_paid::text, s.balance_due::text
          from hotel_stay_sales l join sales s on s.id = l.sale_id
         where l.stay_id = ${first.id} and s.status = 'completed' and s.balance_due > 0
         order by s.sale_date asc, s.id asc for update of s`;
      const dues: DueRow[] = raw.map((r) => ({ id: r.id, receipt_number: r.receipt_number, due: decimalToCents(r.balance_due), total: decimalToCents(r.total), paid: decimalToCents(r.amount_paid) }));
      const owed = dues.reduce((s, r) => s + r.due, 0n);

      const available = decimalToCents(first.depositAmount) - decimalToCents(first.depositApplied) - decimalToCents(first.depositRefunded);
      const useDeposit = available < owed ? available : owed;
      const remaining = owed - useDeposit;
      const supplied = parts.reduce((s, p) => s + p.amount, 0n);
      if (supplied !== remaining) {
        throw new AppError(400, remaining === 0n
          ? "Nothing is left to pay: the deposit covers the account. Remove the payment lines."
          : `The guest still owes ${centsToString(remaining)} after the deposit. Payments entered add up to ${centsToString(supplied)}. The account must be paid in full before check-out.`);
      }
      const excess = available - useDeposit;
      let refundMethod: string | null = null;
      let refundReference: string | null = null;
      if (excess > 0n) {
        refundMethod = methodOf(body.refundMethod, "Refund method");
        refundReference = text(body.refundReference, 100, "Refund reference");
      }

      let n = 0;
      const pay = async (cents: bigint, method: string, reference: string | null, label: string) => {
        let left = cents;
        let firstPart = true;
        for (const row of dues) {
          if (left === 0n) break;
          if (row.due === 0n) continue;
          const take = left < row.due ? left : row.due;
          row.paid += take;
          row.due -= take;
          await tx.payment.create({
            data: {
              businessId, saleId: row.id, amount: centsToString(take), method,
              reference: firstPart ? reference : null,
              notes: [`Room ${first.roomName} check-out: ${label}`, notes].filter(Boolean).join(" - ").slice(0, 500),
              idempotencyKey: `stay-${first.publicId}-co-${n}#${row.id}`,
              createdBy: userId,
            },
          });
          await tx.sale.update({
            where: { id: row.id },
            data: { amountPaid: centsToString(row.paid), balanceDue: centsToString(row.due), paymentStatus: row.due === 0n ? "paid" : "partial" },
          });
          firstPart = false;
          left -= take;
        }
        n += 1;
      };

      if (useDeposit > 0n) await pay(useDeposit, "deposit", null, "deposit applied");
      for (const p of parts) {
        const ref = await checkedPaymentReference(tx, businessId, p.method, p.reference);
        await pay(p.amount, p.method, ref, `${p.method} payment`);
      }

      // The room account is settled in full, so the guest's running balance drops by exactly what was owed.
      if (owed > 0n) {
        await tx.$executeRaw`
          update customers set balance = greatest(balance - ${centsToString(owed)}::numeric, 0), updated_at = now()
           where id = ${first.customerId} and business_id = ${businessId}`;
      }
      await tx.hotelStay.update({
        where: { id: first.id },
        data: {
          status: "checked_out", checkedOutAt: new Date(), checkedOutBy: userId, updatedAt: new Date(),
          depositApplied: centsToString(decimalToCents(first.depositApplied) + useDeposit),
          depositRefunded: centsToString(decimalToCents(first.depositRefunded) + excess),
          refundMethod, refundReference,
        },
      });
      await tx.auditLog.create({
        data: {
          businessId, userId, action: "hotel.checkout", entity: "hotel_stay", entityId: first.id,
          details: { room: first.roomName, owed: centsToString(owed), depositApplied: centsToString(useDeposit), depositRefunded: centsToString(excess), paid: parts.map((p) => ({ method: p.method, amount: centsToString(p.amount) })) },
        },
      });
    }, { timeout: 60_000, maxWait: 15_000 });
  } catch (e) {
    if (isMpesaClash(e)) throw new AppError(409, MPESA_CLASH_MESSAGE);
    throw e;
  }
  return { ...(await folio(businessId, idText)), alreadyCheckedOut: false };
}

export type { Tx };
