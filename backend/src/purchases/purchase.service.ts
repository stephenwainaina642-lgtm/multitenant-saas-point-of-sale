import { addBranchStock } from "../branches/branch-stock.js";
import prisma from "../lib/prisma.js";
import { AppError } from "../lib/errors.js";
import {
  centsToString,
  decimalToCents,
  lineAmount,
  milliToString,
  parseMoney,
  parseQuantity,
} from "../lib/money.js";

type PurchaseItemData = {
  productId: string;
  quantity: number;
  unitCost: number;
  discount?: number;
  tax?: number;
};

type PurchaseData = {
  supplierId: string;
  invoiceNumber?: string;
  discount?: number;
  tax?: number;
  amountPaid?: number;
  paymentMethod?: string;
  paymentReference?: string;
  notes?: string;
  items: PurchaseItemData[];
};

export function purchaseStatus(status: string, total: bigint, paid: bigint) {
  if (status === "voided") return "voided";
  if (paid >= total) return "paid";
  return paid > 0n ? "partial" : "unpaid";
}

export async function getBusinessPurchases(
  businessId: string
) {
  const purchases = await prisma.purchase.findMany({
    where: {
      businessId: BigInt(businessId),
    },
    include: {
      supplier: {
        select: {
          id: true,
          name: true,
        },
      },
      items: {
        include: {
          product: {
            select: {
              id: true,
              name: true,
              sku: true,
              unitOfMeasure: true,
            },
          },
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return purchases.map((purchase) => ({
    id: purchase.id.toString(),
    supplierId: purchase.supplierId.toString(),
    supplierName: purchase.supplier.name,
    invoiceNumber: purchase.invoiceNumber,
    purchaseDate: purchase.purchaseDate,
    subtotal: purchase.subtotal,
    discount: purchase.discount,
    tax: purchase.tax,
    total: purchase.total,
    amountPaid: purchase.amountPaid,
    balanceDue: purchase.balanceDue,
    status: purchase.status,
    paymentStatus: purchaseStatus(purchase.status, decimalToCents(purchase.total), decimalToCents(purchase.amountPaid)),
    notes: purchase.notes,
    createdAt: purchase.createdAt,
    items: purchase.items.map((item) => ({
      id: item.id.toString(),
      productId: item.productId.toString(),
      productName: item.product.name,
      sku: item.product.sku,
      unitOfMeasure: item.product.unitOfMeasure,
      quantity: item.quantity,
      unitCost: item.unitCost,
      discount: item.discount,
      tax: item.tax,
      total: item.total,
    })),
  }));
}

export async function createBusinessPurchase(
  businessId: string,
  data: PurchaseData,
  actorUserId?: string,
  branchIdIn?: bigint
) {
  if (!data.items || data.items.length === 0) {
    throw new AppError(400, "At least one purchase item is required");
  }

  const bizId = BigInt(businessId);

  return prisma.$transaction(async (tx) => {
    const supplier = await tx.supplier.findFirst({
      where: {
        id: BigInt(data.supplierId),
        businessId: bizId,
        isActive: true,
      },
    });

    if (!supplier) {
      throw new AppError(404, "Supplier not found");
    }

    type Line = {
      productId: bigint;
      quantity: bigint;
      unitCost: bigint;
      discount: bigint;
      tax: bigint;
      total: bigint;
    };
    const lines: Line[] = [];

    for (const item of data.items) {
      const quantity = parseQuantity(item.quantity, "Quantity");
      const unitCost = parseMoney(item.unitCost, "Unit cost");
      const discount = parseMoney(item.discount ?? 0, "Discount");
      const tax = parseMoney(item.tax ?? 0, "Tax");

      if (quantity <= 0n) {
        throw new AppError(400, "Quantity must be greater than zero");
      }
      if (unitCost < 0n) {
        throw new AppError(400, "Unit cost cannot be negative");
      }
      if (discount < 0n) {
        throw new AppError(400, "Discount cannot be negative");
      }
      if (tax < 0n) {
        throw new AppError(400, "Tax cannot be negative");
      }

      const product = await tx.product.findFirst({
        where: {
          id: BigInt(item.productId),
          businessId: bizId,
          isActive: true,
        },
        select: { id: true },
      });

      if (!product) {
        throw new AppError(404, `Product not found: ${item.productId}`);
      }

      const lineTotal = lineAmount(quantity, unitCost) - discount + tax;
      if (lineTotal < 0n) {
        throw new AppError(400, "Item total cannot be negative");
      }

      lines.push({
        productId: product.id,
        quantity,
        unitCost,
        discount,
        tax,
        total: lineTotal,
      });
    }

    const purchaseDiscount = parseMoney(data.discount ?? 0, "Purchase discount");
    const purchaseTax = parseMoney(data.tax ?? 0, "Purchase tax");
    const amountPaid = parseMoney(data.amountPaid ?? 0, "Amount paid");

    if (purchaseDiscount < 0n) {
      throw new AppError(400, "Purchase discount cannot be negative");
    }
    if (purchaseTax < 0n) {
      throw new AppError(400, "Purchase tax cannot be negative");
    }
    if (amountPaid < 0n) {
      throw new AppError(400, "Amount paid cannot be negative");
    }

    const subtotal = lines.reduce(
      (sum, l) => sum + lineAmount(l.quantity, l.unitCost),
      0n
    );
    const discount = lines.reduce((sum, l) => sum + l.discount, purchaseDiscount);
    const tax = lines.reduce((sum, l) => sum + l.tax, purchaseTax);
    const total = subtotal - discount + tax;

    if (total < 0n) {
      throw new AppError(400, "Purchase total cannot be negative");
    }
    if (amountPaid > total) {
      throw new AppError(400, "Amount paid cannot exceed purchase total");
    }

    const balanceDue = total - amountPaid;

    let paymentMethod = "";
    if (amountPaid > 0n) {
      paymentMethod = (data.paymentMethod ?? "").trim();
      if (!paymentMethod) {
        throw new AppError(400, "Payment method is required when an amount is paid");
      }
      if (paymentMethod.length > 50) {
        throw new AppError(400, "Payment method must not exceed 50 characters");
      }
    }

    // Stock is received into the branch recording the purchase (Main when none is given).
    const branchId =
      branchIdIn ?? (await tx.branch.findFirstOrThrow({ where: { businessId: bizId, isMain: true } })).id;

    const purchase = await tx.purchase.create({
      data: {
        businessId: bizId,
        branchId,
        supplierId: supplier.id,
        invoiceNumber: data.invoiceNumber || null,
        subtotal: centsToString(subtotal),
        discount: centsToString(discount),
        tax: centsToString(tax),
        total: centsToString(total),
        amountPaid: centsToString(amountPaid),
        balanceDue: centsToString(balanceDue),
        status: "received",
        notes: data.notes || null,
        items: {
          create: lines.map((l) => ({
            productId: l.productId,
            quantity: milliToString(l.quantity),
            unitCost: centsToString(l.unitCost),
            discount: centsToString(l.discount),
            tax: centsToString(l.tax),
            total: centsToString(l.total),
          })),
        },
      },
      include: { items: true },
    });

    if (amountPaid > 0n) {
      await tx.supplierPayment.create({
        data: {
          businessId: bizId,
          purchaseId: purchase.id,
          amount: centsToString(amountPaid),
          method: paymentMethod,
          reference: data.paymentReference?.trim() || null,
          notes: "Paid at the time of purchase",
          createdBy: actorUserId ? BigInt(actorUserId) : null,
        },
      });
    }

    // What we still owe this supplier (atomic, so concurrent purchases add up).
    if (balanceDue > 0n) {
      await tx.supplier.update({
        where: { id: supplier.id },
        data: { balance: { increment: centsToString(balanceDue) } },
      });
    }

    // Atomic increment: concurrent receipts of the same product cannot
    // overwrite each other. Stable order avoids deadlocks.
    const ordered = [...lines].sort((a, b) =>
      a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0
    );

    for (const line of ordered) {
      await addBranchStock(tx, bizId, branchId, line.productId, milliToString(line.quantity));
      await tx.product.update({
        where: { id: line.productId },
        data: { costPrice: centsToString(line.unitCost) },
      });

      await tx.inventoryMovement.create({
        data: {
          businessId: bizId,
          branchId,
          productId: line.productId,
          type: "IN",
          quantity: milliToString(line.quantity),
          reference: `PURCHASE-${purchase.id.toString()}`,
          notes: `Stock received from ${supplier.name}`,
        },
      });
    }

    return {
      id: purchase.id.toString(),
      supplierId: purchase.supplierId.toString(),
      supplierName: supplier.name,
      invoiceNumber: purchase.invoiceNumber,
      purchaseDate: purchase.purchaseDate,
      subtotal: purchase.subtotal,
      discount: purchase.discount,
      tax: purchase.tax,
      total: purchase.total,
      amountPaid: purchase.amountPaid,
      balanceDue: purchase.balanceDue,
      status: purchase.status,
      paymentStatus: purchaseStatus(purchase.status, total, amountPaid),
      notes: purchase.notes,
      createdAt: purchase.createdAt,
      items: purchase.items.map((item) => ({
        id: item.id.toString(),
        productId: item.productId.toString(),
        quantity: item.quantity,
        unitCost: item.unitCost,
        discount: item.discount,
        tax: item.tax,
        total: item.total,
      })),
    };
  });
}
