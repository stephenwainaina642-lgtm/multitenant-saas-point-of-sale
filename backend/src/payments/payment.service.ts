import prisma from "../lib/prisma.js";
import { AppError } from "../lib/errors.js";
import { centsToString, decimalToCents, parseMoney } from "../lib/money.js";

type PaymentData = {
  saleId: string;
  amount: number;
  method: string;
  reference?: string;
  notes?: string;
  idempotencyKey?: string | undefined;
};

export async function getBusinessPayments(
  businessId: string
) {
  const payments = await prisma.payment.findMany({
    where: {
      businessId: BigInt(businessId),
    },
    include: {
      sale: {
        select: {
          id: true,
          receiptNumber: true,
          customer: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return payments.map((payment) => ({
    id: payment.id.toString(),
    saleId: payment.saleId.toString(),
    receiptNumber: payment.sale.receiptNumber,
    customerId: payment.sale.customer?.id.toString() || null,
    customerName: payment.sale.customer?.name || null,
    amount: payment.amount,
    method: payment.method,
    reference: payment.reference,
    paymentDate: payment.paymentDate,
    notes: payment.notes,
    createdAt: payment.createdAt,
  }));
}

function formatPayment(
  payment: {
    id: bigint;
    saleId: bigint;
    amount: unknown;
    method: string;
    reference: string | null;
    paymentDate: Date;
    notes: string | null;
  },
  sale: {
    id: bigint;
    receiptNumber: string;
    total: unknown;
    amountPaid: unknown;
    balanceDue: unknown;
    paymentStatus: string;
  },
  idempotentReplay: boolean
) {
  return {
    idempotentReplay,
    payment: {
      id: payment.id.toString(),
      saleId: payment.saleId.toString(),
      amount: payment.amount,
      method: payment.method,
      reference: payment.reference,
      paymentDate: payment.paymentDate,
      notes: payment.notes,
    },
    sale: {
      id: sale.id.toString(),
      receiptNumber: sale.receiptNumber,
      total: sale.total,
      amountPaid: sale.amountPaid,
      balanceDue: sale.balanceDue,
      paymentStatus: sale.paymentStatus,
    },
  };
}

export async function createBusinessPayment(
  businessId: string,
  data: PaymentData,
  onlyOwnSalesOf?: string
) {
  const amount = parseMoney(data.amount, "Payment amount");

  if (amount <= 0n) {
    throw new AppError(400, "Payment amount must be greater than zero");
  }

  if (!data.method || !data.method.trim()) {
    throw new AppError(400, "Payment method is required");
  }

  const bizId = BigInt(businessId);
  const key = data.idempotencyKey?.trim() || null;
  if (key && key.length > 100) {
    throw new AppError(400, "Idempotency-Key must not exceed 100 characters");
  }
  const saleId = BigInt(data.saleId);

  try {
    return await prisma.$transaction(async (tx) => {
      if (key) {
        const existing = await tx.payment.findFirst({
          where: { businessId: bizId, idempotencyKey: key },
          include: { sale: true },
        });
        if (existing) {
          if (existing.saleId !== saleId) {
            throw new AppError(
              409,
              "This Idempotency-Key was already used for a different sale"
            );
          }
          return formatPayment(existing, existing.sale, true);
        }
      }

      // Lock the sale row: concurrent payments on one sale are serialized, so
      // each one sees the balance left by the previous one.
      const locked = onlyOwnSalesOf
        ? await tx.$queryRaw<{ id: bigint }[]>`
            SELECT id FROM sales
             WHERE id = ${saleId} AND business_id = ${bizId}
               AND salesperson_id = ${BigInt(onlyOwnSalesOf)}
             FOR UPDATE`
        : await tx.$queryRaw<{ id: bigint }[]>`
            SELECT id FROM sales
             WHERE id = ${saleId} AND business_id = ${bizId}
             FOR UPDATE`;

      if (locked.length === 0) {
        throw new AppError(404, "Sale not found");
      }

      const sale = await tx.sale.findUniqueOrThrow({ where: { id: saleId } });

      const total = decimalToCents(sale.total);
      const paid = decimalToCents(sale.amountPaid);
      const currentBalance = total - paid;

      if (currentBalance <= 0n) {
        throw new AppError(400, "Sale has no outstanding balance");
      }

      if (amount > currentBalance) {
        throw new AppError(
          400,
          "Payment amount cannot exceed outstanding balance"
        );
      }

      const newAmountPaid = paid + amount;
      const newBalanceDue = total - newAmountPaid;
      const paymentStatus = newBalanceDue === 0n ? "paid" : "partial";

      const payment = await tx.payment.create({
        data: {
          businessId: bizId,
          saleId: sale.id,
          amount: centsToString(amount),
          method: data.method.trim().toLowerCase(),
          reference: data.reference?.trim() || null,
          notes: data.notes?.trim() || null,
          idempotencyKey: key,
        },
      });

      const updatedSale = await tx.sale.update({
        where: { id: sale.id },
        data: {
          amountPaid: centsToString(newAmountPaid),
          balanceDue: centsToString(newBalanceDue),
          paymentStatus,
        },
      });

      // Keep the customer's running balance in step (never below zero, so
      // sales recorded before balances were tracked cannot drive it negative).
      if (sale.customerId) {
        await tx.$executeRaw`
          UPDATE customers
             SET balance = GREATEST(balance - ${centsToString(amount)}::numeric, 0),
                 updated_at = now()
           WHERE id = ${sale.customerId} AND business_id = ${bizId}`;
      }

      return formatPayment(payment, updatedSale, false);
    });
  } catch (error) {
    if (
      key &&
      typeof error === "object" &&
      error !== null &&
      (error as { code?: string }).code === "P2002"
    ) {
      const existing = await prisma.payment.findFirst({
        where: { businessId: bizId, idempotencyKey: key },
        include: { sale: true },
      });
      if (existing && existing.saleId === saleId) {
        return formatPayment(existing, existing.sale, true);
      }
    }
    throw error;
  }
}
