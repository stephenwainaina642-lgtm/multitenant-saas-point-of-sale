import prisma from "../lib/prisma.js";
import { AppError } from "../lib/errors.js";
import {
  centsToString,
  decimalToCents,
  decimalToMilli,
  milliToString,
} from "../lib/money.js";
import {
  aggregateByProduct,
  buildSaleLines,
  computeSaleTotals,
  type RawSaleItem,
  type Tx,
} from "./sale-calc.js";

export type EditSaleData = {
  customerId?: string | null;
  discount?: number;
  tax?: number;
  notes?: string | null;
  items: RawSaleItem[];
};

type Actor = {
  userId: string;
  /** Set when the actor may only touch sales they made themselves. */
  onlyOwnSales: boolean;
};

async function lockSale(tx: Tx, businessId: bigint, saleId: bigint, actor: Actor) {
  const locked = actor.onlyOwnSales
    ? await tx.$queryRaw<{ id: bigint }[]>`
        SELECT id FROM sales
         WHERE id = ${saleId} AND business_id = ${businessId}
           AND salesperson_id = ${BigInt(actor.userId)}
         FOR UPDATE`
    : await tx.$queryRaw<{ id: bigint }[]>`
        SELECT id FROM sales
         WHERE id = ${saleId} AND business_id = ${businessId}
         FOR UPDATE`;

  if (locked.length === 0) {
    throw new AppError(404, "Sale not found");
  }

  return tx.sale.findUniqueOrThrow({
    where: { id: saleId },
    include: { items: true },
  });
}

function parseSaleId(id: string): bigint {
  if (!/^[1-9]\d*$/.test(id)) {
    throw new AppError(404, "Sale not found");
  }
  return BigInt(id);
}

async function releaseCustomerBalance(
  tx: Tx,
  businessId: bigint,
  customerId: bigint | null,
  amount: bigint
) {
  if (!customerId || amount <= 0n) return;

  await tx.$executeRaw`
    UPDATE customers
       SET balance = GREATEST(balance - ${centsToString(amount)}::numeric, 0),
           updated_at = now()
     WHERE id = ${customerId} AND business_id = ${businessId}`;
}

async function addCustomerBalance(
  tx: Tx,
  businessId: bigint,
  customer: { id: bigint; name: string },
  amount: bigint
) {
  if (amount <= 0n) return;

  const updated = await tx.$executeRaw`
    UPDATE customers
       SET balance = balance + ${centsToString(amount)}::numeric,
           updated_at = now()
     WHERE id = ${customer.id}
       AND business_id = ${businessId}
       AND (credit_limit = 0
            OR balance + ${centsToString(amount)}::numeric <= credit_limit)`;

  if (updated === 0) {
    throw new AppError(400, `Credit limit exceeded for customer: ${customer.name}`);
  }
}

function snapshot(sale: {
  customerId: bigint | null;
  subtotal: unknown;
  discount: unknown;
  tax: unknown;
  total: unknown;
  amountPaid: unknown;
  balanceDue: unknown;
  notes: string | null;
  items: { productId: bigint; quantity: unknown; unitPrice: unknown; discount: unknown; tax: unknown; total: unknown }[];
}) {
  return {
    customerId: sale.customerId?.toString() ?? null,
    subtotal: String(sale.subtotal),
    discount: String(sale.discount),
    tax: String(sale.tax),
    total: String(sale.total),
    amountPaid: String(sale.amountPaid),
    balanceDue: String(sale.balanceDue),
    notes: sale.notes,
    items: sale.items.map((i) => ({
      productId: i.productId.toString(),
      quantity: String(i.quantity),
      unitPrice: String(i.unitPrice),
      discount: String(i.discount),
      tax: String(i.tax),
      total: String(i.total),
    })),
  };
}

/**
 * Edit a completed sale. Payments are historical records and are never changed:
 * the new total may not fall below what has already been paid. Stock and the
 * customer balance move by the exact difference, in the same transaction.
 */
export async function editBusinessSale(
  businessId: string,
  saleIdText: string,
  data: EditSaleData,
  actor: Actor
) {
  if (!data.items || data.items.length === 0) {
    throw new AppError(400, "At least one sale item is required");
  }

  const bizId = BigInt(businessId);
  const saleId = parseSaleId(saleIdText);

  return prisma.$transaction(async (tx) => {
    const sale = await lockSale(tx, bizId, saleId, actor);

    if (sale.status !== "completed") {
      throw new AppError(409, "Only completed sales can be edited");
    }

    const before = snapshot(sale);

    // Customer: undefined keeps the current one, null/"" removes it.
    let customer: { id: bigint; name: string } | null = null;
    if (data.customerId === undefined) {
      if (sale.customerId) {
        customer = await tx.customer.findFirst({
          where: { id: sale.customerId, businessId: bizId },
          select: { id: true, name: true },
        });
      }
    } else if (data.customerId !== null && data.customerId !== "") {
      customer = await tx.customer.findFirst({
        where: { id: BigInt(data.customerId), businessId: bizId, isActive: true },
        select: { id: true, name: true },
      });
      if (!customer) {
        throw new AppError(404, "Customer not found");
      }
    }

    const existing = new Map<bigint, Set<bigint>>();
    for (const item of sale.items) {
      const prices = existing.get(item.productId) ?? new Set<bigint>();
      prices.add(decimalToCents(item.unitPrice));
      existing.set(item.productId, prices);
    }

    const lines = await buildSaleLines(tx, bizId, data.items, { existing });
    const { subtotal, discount, tax, total } = computeSaleTotals(
      lines,
      data.discount,
      data.tax
    );

    const paid = decimalToCents(sale.amountPaid);

    if (total < paid) {
      throw new AppError(
        409,
        `The new total (${centsToString(total)}) is lower than the amount already paid (${centsToString(paid)}). ` +
          "Void the sale and issue a refund instead; the sale was not changed"
      );
    }

    const balanceDue = total - paid;

    if (balanceDue > 0n && !customer) {
      throw new AppError(
        400,
        "A customer is required for a sale with an outstanding balance"
      );
    }

    // Customer balance: release the old amount, then charge the new one.
    await releaseCustomerBalance(
      tx,
      bizId,
      sale.customerId,
      decimalToCents(sale.balanceDue)
    );
    if (customer) {
      await addCustomerBalance(tx, bizId, customer, balanceDue);
    }

    // Stock: move only by the difference per product, in a stable lock order.
    const oldQty = new Map(
      aggregateByProduct(
        sale.items.map((i) => ({ productId: i.productId, quantity: decimalToMilli(i.quantity) }))
      )
    );
    const newQty = new Map(aggregateByProduct(lines));
    const productIds = [...new Set([...oldQty.keys(), ...newQty.keys()])].sort((a, b) =>
      a < b ? -1 : a > b ? 1 : 0
    );

    for (const productId of productIds) {
      const was = oldQty.get(productId)?.quantity ?? 0n;
      const now = newQty.get(productId)?.quantity ?? 0n;
      const delta = now - was;
      if (delta === 0n) continue;

      if (delta > 0n) {
        const updated = await tx.$executeRaw`
          UPDATE products
             SET stock_quantity = stock_quantity - ${milliToString(delta)}::numeric,
                 updated_at = now()
           WHERE id = ${productId}
             AND business_id = ${bizId}
             AND stock_quantity >= ${milliToString(delta)}::numeric`;
        if (updated === 0) {
          const name = newQty.get(productId)?.name ?? "";
          throw new AppError(400, `Insufficient stock for product: ${name}`);
        }
      } else {
        await tx.$executeRaw`
          UPDATE products
             SET stock_quantity = stock_quantity + ${milliToString(-delta)}::numeric,
                 updated_at = now()
           WHERE id = ${productId} AND business_id = ${bizId}`;
      }

      await tx.inventoryMovement.create({
        data: {
          businessId: bizId,
          productId,
          type: delta > 0n ? "OUT" : "IN",
          quantity: milliToString(delta > 0n ? delta : -delta),
          reference: `SALE-EDIT-${saleId.toString()}`,
          notes: "Stock adjusted by sale edit",
        },
      });
    }

    const paymentStatus =
      balanceDue === 0n ? "paid" : paid > 0n ? "partial" : "unpaid";

    await tx.saleItem.deleteMany({ where: { saleId } });

    const updated = await tx.sale.update({
      where: { id: saleId },
      data: {
        customerId: customer?.id ?? null,
        subtotal: centsToString(subtotal),
        discount: centsToString(discount),
        tax: centsToString(tax),
        total: centsToString(total),
        balanceDue: centsToString(balanceDue),
        paymentStatus,
        ...(data.notes !== undefined && { notes: data.notes?.trim() || null }),
        items: {
          create: lines.map((l) => ({
            productId: l.productId,
            quantity: milliToString(l.quantity),
            unitPrice: centsToString(l.unitPrice),
            costPrice: centsToString(l.costPrice),
            discount: centsToString(l.discount),
            tax: centsToString(l.tax),
            total: centsToString(l.total),
          })),
        },
      },
      include: { items: true },
    });

    await tx.auditLog.create({
      data: {
        businessId: bizId,
        userId: BigInt(actor.userId),
        action: "sale.edit",
        entity: "sale",
        entityId: saleId,
        details: { before, after: snapshot(updated) },
      },
    });

    return {
      id: updated.id.toString(),
      receiptNumber: updated.receiptNumber,
      customerId: updated.customerId?.toString() ?? null,
      subtotal: updated.subtotal,
      discount: updated.discount,
      tax: updated.tax,
      total: updated.total,
      amountPaid: updated.amountPaid,
      balanceDue: updated.balanceDue,
      paymentStatus: updated.paymentStatus,
      status: updated.status,
      notes: updated.notes,
      items: updated.items.map((item) => ({
        id: item.id.toString(),
        productId: item.productId.toString(),
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discount: item.discount,
        tax: item.tax,
        total: item.total,
      })),
    };
  });
}

export type VoidSaleData = {
  reason?: unknown;
  refundMethod?: unknown;
  refundReference?: unknown;
};

/**
 * Cancel a sale. Stock returns to the shelf, the customer's balance drops the
 * unpaid amount, and money already paid is refunded through a separate refund
 * record (payments are never deleted or edited).
 */
export async function voidBusinessSale(
  businessId: string,
  saleIdText: string,
  data: VoidSaleData,
  actor: Actor
) {
  const reason = typeof data.reason === "string" ? data.reason.trim() : "";

  if (!reason || reason.length > 500) {
    throw new AppError(400, "A reason is required to void a sale (max 500 characters)");
  }

  const bizId = BigInt(businessId);
  const saleId = parseSaleId(saleIdText);

  return prisma.$transaction(async (tx) => {
    const sale = await lockSale(tx, bizId, saleId, actor);

    if (sale.status !== "completed") {
      throw new AppError(409, "This sale has already been voided");
    }

    const paid = decimalToCents(sale.amountPaid);
    let refundMethod = "";

    if (paid > 0n) {
      refundMethod =
        typeof data.refundMethod === "string" ? data.refundMethod.trim().toLowerCase() : "";
      if (!refundMethod || refundMethod.length > 50) {
        throw new AppError(
          400,
          "A refund method is required because this sale has payments to refund"
        );
      }
    }

    const quantities = aggregateByProduct(
      sale.items.map((i) => ({ productId: i.productId, quantity: decimalToMilli(i.quantity) }))
    );

    for (const [productId, entry] of quantities) {
      await tx.$executeRaw`
        UPDATE products
           SET stock_quantity = stock_quantity + ${milliToString(entry.quantity)}::numeric,
               updated_at = now()
         WHERE id = ${productId} AND business_id = ${bizId}`;

      await tx.inventoryMovement.create({
        data: {
          businessId: bizId,
          productId,
          type: "IN",
          quantity: milliToString(entry.quantity),
          reference: `SALE-VOID-${saleId.toString()}`,
          notes: "Stock returned: sale voided",
        },
      });
    }

    await releaseCustomerBalance(
      tx,
      bizId,
      sale.customerId,
      decimalToCents(sale.balanceDue)
    );

    let refund = null;
    if (paid > 0n) {
      const reference =
        typeof data.refundReference === "string" ? data.refundReference.trim() : "";
      refund = await tx.refund.create({
        data: {
          businessId: bizId,
          saleId,
          amount: centsToString(paid),
          method: refundMethod,
          reference: reference ? reference.slice(0, 255) : null,
          reason,
          createdBy: BigInt(actor.userId),
        },
      });
    }

    const updated = await tx.sale.update({
      where: { id: saleId },
      data: { status: "voided", paymentStatus: paid > 0n ? "refunded" : "voided" },
    });

    await tx.auditLog.create({
      data: {
        businessId: bizId,
        userId: BigInt(actor.userId),
        action: "sale.void",
        entity: "sale",
        entityId: saleId,
        details: {
          reason,
          total: String(sale.total),
          amountPaid: String(sale.amountPaid),
          refunded: refund ? String(refund.amount) : "0.00",
          refundMethod: refundMethod || null,
        },
      },
    });

    return {
      id: updated.id.toString(),
      receiptNumber: updated.receiptNumber,
      status: updated.status,
      paymentStatus: updated.paymentStatus,
      refund: refund
        ? {
            id: refund.id.toString(),
            amount: refund.amount,
            method: refund.method,
            reference: refund.reference,
          }
        : null,
    };
  });
}

