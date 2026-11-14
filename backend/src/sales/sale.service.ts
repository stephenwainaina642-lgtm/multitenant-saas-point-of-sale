import prisma from "../lib/prisma.js";
import { AppError } from "../lib/errors.js";
import {
  centsToString,
  decimalToCents,
  decimalToMilli,
  lineAmount,
  milliToString,
  parseMoney,
  parseQuantity,
} from "../lib/money.js";

type SaleItemData = {
  productId: string;
  quantity: number;
  unitPrice: number;
  discount?: number;
  tax?: number;
};

type SaleData = {
  customerId?: string;
  discount?: number;
  tax?: number;
  amountPaid?: number;
  paymentMethod?: string;
  notes?: string;
  items: SaleItemData[];
};

export async function getBusinessSales(
  businessId: string,
  userId: string,
  canViewAll: boolean
) {
  const sales = await prisma.sale.findMany({
    where: {
      businessId: BigInt(businessId),
      ...(!canViewAll && {
        salespersonId: BigInt(userId),
      }),
    },
    include: {
      customer: {
        select: {
          id: true,
          name: true,
        },
      },
      salesperson: {
        select: {
          id: true,
          name: true,
          email: true,
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

  return sales.map((sale) => ({
    id: sale.id.toString(),
    customerId: sale.customerId?.toString() || null,
    customerName: sale.customer?.name || null,
    salespersonId: sale.salesperson?.id.toString() || null,
    salespersonName: sale.salesperson?.name || null,
    salespersonEmail: sale.salesperson?.email || null,
    receiptNumber: sale.receiptNumber,
    saleDate: sale.saleDate,
    subtotal: sale.subtotal,
    discount: sale.discount,
    tax: sale.tax,
    total: sale.total,
    amountPaid: sale.amountPaid,
    balanceDue: sale.balanceDue,
    paymentStatus: sale.paymentStatus,
    status: sale.status,
    notes: sale.notes,
    createdAt: sale.createdAt,
    items: sale.items.map((item) => ({
      id: item.id.toString(),
      productId: item.productId.toString(),
      productName: item.product.name,
      sku: item.product.sku,
      unitOfMeasure: item.product.unitOfMeasure,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      costPrice: item.costPrice,
      discount: item.discount,
      tax: item.tax,
      total: item.total,
    })),
  }));
}

export async function getBusinessSaleById(
  businessId: string,
  saleId: string,
  userId: string,
  canViewAll: boolean
) {
  const sale = await prisma.sale.findFirst({
    where: {
      id: BigInt(saleId),
      businessId: BigInt(businessId),
      ...(!canViewAll && {
        salespersonId: BigInt(userId),
      }),
    },
    include: {
      customer: {
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
        },
      },
      salesperson: {
        select: {
          id: true,
          name: true,
          email: true,
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
      payments: {
        orderBy: {
          paymentDate: "asc",
        },
      },
    },
  });

  if (!sale) {
    throw new Error("Sale not found");
  }

  return {
    id: sale.id.toString(),
    customerId: sale.customerId?.toString() || null,
    customerName: sale.customer?.name || null,
    salespersonId: sale.salesperson?.id.toString() || null,
    salespersonName: sale.salesperson?.name || null,
    salespersonEmail: sale.salesperson?.email || null,    customerPhone: sale.customer?.phone || null,
    customerEmail: sale.customer?.email || null,
    receiptNumber: sale.receiptNumber,
    saleDate: sale.saleDate,
    subtotal: sale.subtotal,
    discount: sale.discount,
    tax: sale.tax,
    total: sale.total,
    amountPaid: sale.amountPaid,
    balanceDue: sale.balanceDue,
    paymentStatus: sale.paymentStatus,
    status: sale.status,
    notes: sale.notes,
    createdAt: sale.createdAt,
    updatedAt: sale.updatedAt,
    items: sale.items.map((item) => ({
      id: item.id.toString(),
      productId: item.productId.toString(),
      productName: item.product.name,
      sku: item.product.sku,
      unitOfMeasure: item.product.unitOfMeasure,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      costPrice: item.costPrice,
      discount: item.discount,
      tax: item.tax,
      total: item.total,
    })),
    payments: sale.payments.map((payment) => ({
      id: payment.id.toString(),
      amount: payment.amount,
      method: payment.method,
      reference: payment.reference,
      paymentDate: payment.paymentDate,
      notes: payment.notes,
    })),
  };
}
type CreateSaleOptions = {
  idempotencyKey?: string | undefined;
};

type SaleRecord = {
  id: bigint;
  customerId: bigint | null;
  receiptNumber: string;
  saleDate: Date;
  subtotal: unknown;
  discount: unknown;
  tax: unknown;
  total: unknown;
  amountPaid: unknown;
  balanceDue: unknown;
  paymentStatus: string;
  status: string;
  notes: string | null;
  createdAt: Date;
  items: {
    id: bigint;
    productId: bigint;
    quantity: unknown;
    costPrice: unknown;
    discount: unknown;
    tax: unknown;
    total: unknown;
  }[];
};

function formatCreatedSale(
  sale: SaleRecord,
  customerName: string | null,
  idempotentReplay: boolean
) {
  return {
    id: sale.id.toString(),
    customerId: sale.customerId?.toString() || null,
    customerName,
    receiptNumber: sale.receiptNumber,
    saleDate: sale.saleDate,
    subtotal: sale.subtotal,
    discount: sale.discount,
    tax: sale.tax,
    total: sale.total,
    amountPaid: sale.amountPaid,
    balanceDue: sale.balanceDue,
    paymentStatus: sale.paymentStatus,
    status: sale.status,
    notes: sale.notes,
    createdAt: sale.createdAt,
    idempotentReplay,
    items: sale.items.map((item) => ({
      id: item.id.toString(),
      productId: item.productId.toString(),
      quantity: item.quantity,
      costPrice: item.costPrice,
      discount: item.discount,
      tax: item.tax,
      total: item.total,
    })),
  };
}

function cleanIdempotencyKey(key: string | undefined) {
  if (key === undefined) return null;
  const trimmed = key.trim();
  if (!trimmed) return null;
  if (trimmed.length > 100) {
    throw new AppError(400, "Idempotency-Key must not exceed 100 characters");
  }
  return trimmed;
}

export async function createBusinessSale(
  businessId: string,
  salespersonId: string,
  data: SaleData,
  options: CreateSaleOptions = {}
) {
  if (!data.items || data.items.length === 0) {
    throw new AppError(400, "At least one sale item is required");
  }

  const idempotencyKey = cleanIdempotencyKey(options.idempotencyKey);
  const bizId = BigInt(businessId);

  try {
    return await prisma.$transaction(async (tx) => {
      // A repeated submission with the same key returns the original sale.
      if (idempotencyKey) {
        const existing = await tx.sale.findFirst({
          where: { businessId: bizId, idempotencyKey },
          include: { items: true, customer: { select: { name: true } } },
        });
        if (existing) {
          return formatCreatedSale(existing, existing.customer?.name ?? null, true);
        }
      }

      let customer: { id: bigint; name: string } | null = null;

      if (data.customerId) {
        customer = await tx.customer.findFirst({
          where: {
            id: BigInt(data.customerId),
            businessId: bizId,
            isActive: true,
          },
          select: { id: true, name: true },
        });

        if (!customer) {
          throw new AppError(404, "Customer not found");
        }
      }

      type Line = {
        productId: bigint;
        productName: string;
        quantity: bigint; // thousandths
        unitPrice: bigint; // cents
        costPrice: bigint;
        discount: bigint;
        tax: bigint;
        total: bigint;
      };
      const lines: Line[] = [];

      for (const item of data.items) {
        const quantity = parseQuantity(item.quantity, "Quantity");
        const unitPrice = parseMoney(item.unitPrice, "Unit price");
        const discount = parseMoney(item.discount ?? 0, "Discount");
        const tax = parseMoney(item.tax ?? 0, "Tax");

        if (quantity <= 0n) {
          throw new AppError(400, "Quantity must be greater than zero");
        }
        if (unitPrice < 0n) {
          throw new AppError(400, "Unit price cannot be negative");
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
        });

        if (!product) {
          throw new AppError(404, `Product not found: ${item.productId}`);
        }

        if (unitPrice !== decimalToCents(product.sellingPrice)) {
          throw new AppError(
            400,
            `Sale price does not match the saved selling price for: ${product.name}`
          );
        }

        const lineTotal = lineAmount(quantity, unitPrice) - discount + tax;

        if (lineTotal < 0n) {
          throw new AppError(400, "Item total cannot be negative");
        }

        lines.push({
          productId: product.id,
          productName: product.name,
          quantity,
          unitPrice,
          costPrice: decimalToCents(product.costPrice),
          discount,
          tax,
          total: lineTotal,
        });
      }

      const saleDiscount = parseMoney(data.discount ?? 0, "Sale discount");
      const saleTax = parseMoney(data.tax ?? 0, "Sale tax");
      const amountPaid = parseMoney(data.amountPaid ?? 0, "Amount paid");

      if (saleDiscount < 0n) {
        throw new AppError(400, "Sale discount cannot be negative");
      }
      if (saleTax < 0n) {
        throw new AppError(400, "Sale tax cannot be negative");
      }
      if (amountPaid < 0n) {
        throw new AppError(400, "Amount paid cannot be negative");
      }

      // subtotal = gross of all lines; discount and tax include both the
      // line-level and the sale-level amounts, so
      // total = subtotal - discount + tax always holds.
      const subtotal = lines.reduce(
        (sum, l) => sum + lineAmount(l.quantity, l.unitPrice),
        0n
      );
      const discount = lines.reduce((sum, l) => sum + l.discount, saleDiscount);
      const tax = lines.reduce((sum, l) => sum + l.tax, saleTax);
      const total = subtotal - discount + tax;

      if (total < 0n) {
        throw new AppError(400, "Sale total cannot be negative");
      }
      if (amountPaid > total) {
        throw new AppError(400, "Amount paid cannot exceed sale total");
      }
      if (amountPaid > 0n && !data.paymentMethod?.trim()) {
        throw new AppError(
          400,
          "Payment method is required when an initial payment is made"
        );
      }

      const balanceDue = total - amountPaid;

      if (balanceDue > 0n && !customer) {
        throw new AppError(
          400,
          "A customer is required for a sale with an outstanding balance"
        );
      }

      // Customer credit: add the balance atomically, refusing if it would
      // exceed a configured credit limit (credit_limit 0 = no limit set).
      if (balanceDue > 0n && customer) {
        const updated = await tx.$executeRaw`
          UPDATE customers
             SET balance = balance + ${centsToString(balanceDue)}::numeric,
                 updated_at = now()
           WHERE id = ${customer.id}
             AND business_id = ${bizId}
             AND (credit_limit = 0
                  OR balance + ${centsToString(balanceDue)}::numeric <= credit_limit)`;
        if (updated === 0) {
          throw new AppError(
            400,
            `Credit limit exceeded for customer: ${customer.name}`
          );
        }
      }

      // Stock: aggregate per product (so duplicate lines cannot oversell) and
      // deduct with a guarded atomic update, in a stable order to avoid deadlocks.
      const perProduct = new Map<bigint, { name: string; quantity: bigint }>();
      for (const l of lines) {
        const entry = perProduct.get(l.productId);
        if (entry) entry.quantity += l.quantity;
        else perProduct.set(l.productId, { name: l.productName, quantity: l.quantity });
      }
      const orderedProducts = [...perProduct.entries()].sort((a, b) =>
        a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0
      );

      for (const [productId, entry] of orderedProducts) {
        const updated = await tx.$executeRaw`
          UPDATE products
             SET stock_quantity = stock_quantity - ${milliToString(entry.quantity)}::numeric,
                 updated_at = now()
           WHERE id = ${productId}
             AND business_id = ${bizId}
             AND is_active = true
             AND stock_quantity >= ${milliToString(entry.quantity)}::numeric`;
        if (updated === 0) {
          throw new AppError(
            400,
            `Insufficient stock for product: ${entry.name}`
          );
        }
      }

      // Per-business sequential receipt number.
      const [sequence] = await tx.$queryRaw<{ n: bigint }[]>`
        INSERT INTO document_sequences (business_id, kind, next_value)
        VALUES (${bizId}, 'sale', 2)
        ON CONFLICT (business_id, kind)
        DO UPDATE SET next_value = document_sequences.next_value + 1
        RETURNING next_value - 1 AS n`;
      const receiptNumber = `RCT-${sequence!.n.toString().padStart(6, "0")}`;

      const paymentStatus =
        balanceDue === 0n ? "paid" : amountPaid > 0n ? "partial" : "unpaid";

      const sale = await tx.sale.create({
        data: {
          businessId: bizId,
          salespersonId: BigInt(salespersonId),
          customerId: customer?.id ?? null,
          receiptNumber,
          subtotal: centsToString(subtotal),
          discount: centsToString(discount),
          tax: centsToString(tax),
          total: centsToString(total),
          amountPaid: centsToString(amountPaid),
          balanceDue: centsToString(balanceDue),
          paymentStatus,
          status: "completed",
          idempotencyKey,
          notes: data.notes || null,
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

      if (amountPaid > 0n) {
        await tx.payment.create({
          data: {
            businessId: bizId,
            saleId: sale.id,
            amount: centsToString(amountPaid),
            method: data.paymentMethod!.trim().toLowerCase(),
            notes: "Initial payment for sale",
          },
        });
      }

      for (const [productId, entry] of orderedProducts) {
        await tx.inventoryMovement.create({
          data: {
            businessId: bizId,
            productId,
            type: "OUT",
            quantity: milliToString(entry.quantity),
            reference: `SALE-${sale.id.toString()}`,
            notes: `Stock sold${customer ? ` to ${customer.name}` : ""}`,
          },
        });
      }

      return formatCreatedSale(sale, customer?.name ?? null, false);
    });
  } catch (error) {
    // Two requests with the same idempotency key raced: return the winner.
    if (
      idempotencyKey &&
      typeof error === "object" &&
      error !== null &&
      (error as { code?: string }).code === "P2002"
    ) {
      const existing = await prisma.sale.findFirst({
        where: { businessId: bizId, idempotencyKey },
        include: { items: true, customer: { select: { name: true } } },
      });
      if (existing) {
        return formatCreatedSale(existing, existing.customer?.name ?? null, true);
      }
    }
    throw error;
  }
}
