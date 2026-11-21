import { takeBranchStock } from "../branches/branch-stock.js";
import prisma from "../lib/prisma.js";
import { AppError } from "../lib/errors.js";
import { centsToString, decimalToCents, milliToString, decimalToMilli, parseMoney } from "../lib/money.js";
import { purchaseStatus } from "./purchase.service.js";
import { purchaseIdFromPublic, requirePublicId } from "../lib/public-id.js";

type Actor = { userId: string };


async function lockPurchase(tx: any, businessId: bigint, id: bigint) {
  const rows = await tx.$queryRaw<{ id: bigint }[]>`
    SELECT id FROM purchases WHERE id = ${id} AND business_id = ${businessId} FOR UPDATE`;
  if (rows.length === 0) throw new AppError(404, "Purchase not found");
  return tx.purchase.findUniqueOrThrow({ where: { id }, include: { supplier: true } });
}

async function reduceSupplierBalance(tx: any, businessId: bigint, supplierId: bigint, cents: bigint) {
  if (cents <= 0n) return;
  const amount = centsToString(cents);
  await tx.$executeRaw`
    UPDATE suppliers SET balance = GREATEST(balance - ${amount}::numeric, 0), updated_at = now()
     WHERE id = ${supplierId} AND business_id = ${businessId}`;
}

export async function getBusinessPurchase(businessId: string, idText: string) {
  const publicId = requirePublicId(idText, "A valid purchase ID is required");
  const p = await prisma.purchase.findFirst({
    where: { publicId, businessId: BigInt(businessId) },
    include: {
      supplier: { select: { publicId: true, name: true } },
      payments: { orderBy: { id: "asc" } },
      items: { include: { product: { select: { publicId: true, name: true, sku: true, unitOfMeasure: true } } } },
    },
  });
  if (!p) throw new AppError(404, "Purchase not found");
  return {
    id: p.publicId,
    supplierId: p.supplier.publicId,
    supplierName: p.supplier.name,
    invoiceNumber: p.invoiceNumber,
    purchaseDate: p.purchaseDate,
    subtotal: p.subtotal, discount: p.discount, tax: p.tax, total: p.total,
    amountPaid: p.amountPaid, balanceDue: p.balanceDue,
    status: p.status,
    paymentStatus: purchaseStatus(p.status, decimalToCents(p.total), decimalToCents(p.amountPaid)),
    notes: p.notes,
    items: p.items.map((i) => ({
      id: i.id.toString(), productId: i.product.publicId, productName: i.product.name,
      sku: i.product.sku, unitOfMeasure: i.product.unitOfMeasure,
      quantity: i.quantity, unitCost: i.unitCost, discount: i.discount, tax: i.tax, total: i.total,
    })),
    payments: p.payments.map((x) => ({
      id: x.publicId, amount: x.amount, method: x.method, reference: x.reference,
      notes: x.notes, paymentDate: x.paymentDate,
    })),
  };
}

export async function recordSupplierPayment(
  businessId: string,
  idText: string,
  data: { amount?: unknown; method?: unknown; reference?: unknown; notes?: unknown },
  actor: Actor
) {
  const bizId = BigInt(businessId);
  const id = await purchaseIdFromPublic(prisma, bizId, idText);
  const amount = parseMoney(data.amount, "Payment amount");
  if (amount <= 0n) throw new AppError(400, "Payment amount must be greater than zero");
  const method = typeof data.method === "string" ? data.method.trim() : "";
  if (!method) throw new AppError(400, "Payment method is required");
  if (method.length > 50) throw new AppError(400, "Payment method must not exceed 50 characters");
  const reference = typeof data.reference === "string" ? data.reference.trim().slice(0, 255) || null : null;
  const notes = typeof data.notes === "string" ? data.notes.trim() || null : null;

  await prisma.$transaction(async (tx) => {
    const purchase = await lockPurchase(tx, bizId, id);
    if (purchase.status !== "received") throw new AppError(409, "Payments cannot be recorded on a voided purchase");

    const due = decimalToCents(purchase.balanceDue);
    if (due <= 0n) throw new AppError(409, "This purchase is already fully paid");
    if (amount > due) throw new AppError(400, "Payment cannot exceed the balance due");

    const paid = decimalToCents(purchase.amountPaid) + amount;
    await tx.supplierPayment.create({
      data: {
        businessId: bizId, purchaseId: id, amount: centsToString(amount), method, reference, notes,
        createdBy: BigInt(actor.userId),
      },
    });
    await tx.purchase.update({
      where: { id },
      data: { amountPaid: centsToString(paid), balanceDue: centsToString(due - amount) },
    });
    await reduceSupplierBalance(tx, bizId, purchase.supplierId, amount);
  });

  return getBusinessPurchase(businessId, idText);
}

export async function voidBusinessPurchase(
  businessId: string,
  idText: string,
  data: { reason?: unknown },
  actor: Actor
) {
  const bizId = BigInt(businessId);
  const id = await purchaseIdFromPublic(prisma, bizId, idText);
  const reason = typeof data.reason === "string" ? data.reason.trim() : "";
  if (!reason) throw new AppError(400, "A reason is required to void a purchase");
  if (reason.length > 500) throw new AppError(400, "Reason must not exceed 500 characters");

  await prisma.$transaction(async (tx) => {
    const purchase = await lockPurchase(tx, bizId, id);
    if (purchase.status !== "received") throw new AppError(409, "This purchase is already voided");
    if (decimalToCents(purchase.amountPaid) > 0n) {
      throw new AppError(
        409,
        "This purchase has payments recorded. Recovering money from a supplier is not supported yet, so it cannot be voided"
      );
    }

    const items = await tx.purchaseItem.findMany({ where: { purchaseId: id }, orderBy: { productId: "asc" } });
    const perProduct = new Map<bigint, bigint>();
    for (const item of items) {
      perProduct.set(item.productId, (perProduct.get(item.productId) ?? 0n) + decimalToMilli(item.quantity));
    }

    for (const [productId, milli] of [...perProduct.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      const qty = milliToString(milli);
      // Guarded: stock that has already been sold cannot be taken back out.
      const changed = await takeBranchStock(tx, bizId, purchase.branchId, productId, qty);
      if (!changed) {
        throw new AppError(409, "Some of this stock has already been sold, so the purchase cannot be voided");
      }
      await tx.inventoryMovement.create({
        data: {
          businessId: bizId, branchId: purchase.branchId, productId, type: "OUT", quantity: qty,
          reference: `PURCHASE-VOID-${id}`, notes: `Purchase voided: ${reason}`.slice(0, 500),
        },
      });
    }

    await reduceSupplierBalance(tx, bizId, purchase.supplierId, decimalToCents(purchase.balanceDue));
    await tx.purchase.update({
      where: { id },
      data: { status: "voided", notes: [purchase.notes, `VOIDED: ${reason}`].filter(Boolean).join("\n") },
    });
    await tx.auditLog.create({
      data: {
        businessId: bizId, userId: BigInt(actor.userId), action: "purchase.void", entity: "purchase",
        entityId: id, details: { reason, total: purchase.total.toFixed(2) },
      },
    });
  });

  return getBusinessPurchase(businessId, idText);
}
