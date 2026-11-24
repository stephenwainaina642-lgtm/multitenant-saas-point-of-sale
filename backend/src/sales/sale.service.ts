import { takeBranchStockClamped, takeBranchStockOrFail } from "../branches/branch-stock.js";
import prisma from "../lib/prisma.js";
import { requirePublicId } from "../lib/public-id.js";
import { AppError } from "../lib/errors.js";
import { checkedPaymentReference, isMpesaClash, MPESA_CLASH_MESSAGE } from "../lib/mpesa.js";
import {
  priceSale,
  enteredSaleDiscount,
  type RawSaleItem,
  type Tx,
  aggregateByProduct,
} from "./sale-calc.js";
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

export const SALE_CHANNELS = ["walk_in", "online", "phone", "delivery", "other"] as const;
function saleChannel(value: unknown): string {
  if (value === undefined || value === null || value === "") return "walk_in";
  if (typeof value === "string" && (SALE_CHANNELS as readonly string[]).includes(value)) return value;
  throw new AppError(400, `Sale type must be one of: ${SALE_CHANNELS.join(", ")}`);
}

type SaleData = {
  customerId?: string;
  discount?: number;
  tax?: number;
  amountPaid?: number;
  paymentMethod?: string;
  paymentReference?: string;
  /** A confirmed (paid) M-PESA STK request used as this sale's payment. */
  mpesaPaymentRequestId?: string;
  /** A confirmed (paid) Pesapal request used as this sale's payment. Method must be "pesapal". */
  pesapalPaymentRequestId?: string;
  channel?: string;
  notes?: string;
  /** The till was offline when this was rung up (client clock; bounded). Stock shortfalls are then recorded, not refused. */
  offlineSoldAt?: Date;
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
          publicId: true,
          name: true,
        },
      },
      salesperson: {
        select: {
          publicId: true,
          name: true,
          email: true,
        },
      },
      items: {
        include: {
          product: {
            select: {
              id: true,
              publicId: true,
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
    id: sale.publicId,
    customerId: sale.customer?.publicId ?? null,
    customerName: sale.customer?.name || null,
    salespersonId: sale.salesperson?.publicId || null,
    salespersonName: sale.salesperson?.name || null,
    salespersonEmail: sale.salesperson?.email || null,
    receiptNumber: sale.receiptNumber,
    saleDate: sale.saleDate,
    subtotal: sale.subtotal,
    discount: sale.discount,
    tax: sale.tax,
    total: sale.total,
    pricesIncludeVat: sale.pricesIncludeVat,
    saleDiscount: centsToString(enteredSaleDiscount(sale)),
    amountPaid: sale.amountPaid,
    balanceDue: sale.balanceDue,
    paymentStatus: sale.paymentStatus,
    status: sale.status,
    channel: sale.channel,
    notes: sale.notes,
    createdAt: sale.createdAt,
    items: sale.items.map((item) => ({
      id: item.id.toString(),
      productId: item.product.publicId,
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
      publicId: requirePublicId(saleId, "A valid sale ID is required"),
      businessId: BigInt(businessId),
      ...(!canViewAll && {
        salespersonId: BigInt(userId),
      }),
    },
    include: {
      customer: {
        select: {
          publicId: true,
          name: true,
          phone: true,
          email: true,
        },
      },
      salesperson: {
        select: {
          publicId: true,
          name: true,
          email: true,
        },
      },
      items: {
        include: {
          product: {
            select: {
              id: true,
              publicId: true,
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
      refunds: {
        orderBy: {
          createdAt: "asc",
        },
      },
    },
  });

  if (!sale) {
    throw new Error("Sale not found");
  }

  return {
    id: sale.publicId,
    customerId: sale.customer?.publicId ?? null,
    customerName: sale.customer?.name || null,
    salespersonId: sale.salesperson?.publicId || null,
    salespersonName: sale.salesperson?.name || null,
    salespersonEmail: sale.salesperson?.email || null,    customerPhone: sale.customer?.phone || null,
    customerEmail: sale.customer?.email || null,
    receiptNumber: sale.receiptNumber,
    saleDate: sale.saleDate,
    subtotal: sale.subtotal,
    discount: sale.discount,
    tax: sale.tax,
    total: sale.total,
    pricesIncludeVat: sale.pricesIncludeVat,
    saleDiscount: centsToString(enteredSaleDiscount(sale)),
    amountPaid: sale.amountPaid,
    balanceDue: sale.balanceDue,
    paymentStatus: sale.paymentStatus,
    status: sale.status,
    channel: sale.channel,
    notes: sale.notes,
    createdAt: sale.createdAt,
    updatedAt: sale.updatedAt,
    items: sale.items.map((item) => ({
      id: item.id.toString(),
      productId: item.product.publicId,
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
    refunds: sale.refunds.map((refund) => ({
      id: refund.id.toString(),
      amount: refund.amount,
      method: refund.method,
      reference: refund.reference,
      reason: refund.reason,
      createdAt: refund.createdAt,
    })),
  };
}
type CreateSaleOptions = {
  idempotencyKey?: string | undefined;
  /** Price in this mode instead of the business's current one (quotation conversion keeps its own). */
  pricesIncludeVat?: boolean | undefined;
  /** The branch selling; defaults to the business's Main branch. */
  branchId?: bigint | undefined;
};

type SaleRecord = {
  id: bigint;
  publicId: string;
  customerId: bigint | null;
  receiptNumber: string;
  saleDate: Date;
  subtotal: unknown;
  discount: unknown;
  tax: unknown;
  total: unknown;
  pricesIncludeVat: boolean;
  amountPaid: unknown;
  balanceDue: unknown;
  paymentStatus: string;
  status: string;
  channel: string;
  notes: string | null;
  createdAt: Date;
  items: {
    id: bigint;
    productId: bigint;
    product: { publicId: string };
    quantity: unknown;
    costPrice: unknown;
    discount: unknown;
    tax: unknown;
    total: unknown;
  }[];
};

function formatCreatedSale(
  sale: SaleRecord,
  customer: { publicId: string; name: string } | null,
  idempotentReplay: boolean
) {
  return {
    id: sale.publicId,
    customerId: customer?.publicId ?? null,
    customerName: customer?.name ?? null,
    receiptNumber: sale.receiptNumber,
    saleDate: sale.saleDate,
    subtotal: sale.subtotal,
    discount: sale.discount,
    tax: sale.tax,
    total: sale.total,
    pricesIncludeVat: sale.pricesIncludeVat,
    amountPaid: sale.amountPaid,
    balanceDue: sale.balanceDue,
    paymentStatus: sale.paymentStatus,
    status: sale.status,
    channel: sale.channel,
    notes: sale.notes,
    createdAt: sale.createdAt,
    idempotentReplay,
    items: sale.items.map((item) => ({
      id: item.id.toString(),
      productId: item.product.publicId,
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
          include: { items: { include: { product: { select: { publicId: true } } } }, customer: { select: { publicId: true, name: true } } },
        });
        if (existing) {
          return formatCreatedSale(existing, existing.customer ?? null, true);
        }
      }

      let customer: { id: bigint; publicId: string; name: string } | null = null;

      if (data.customerId) {
        customer = await tx.customer.findFirst({
          where: {
            publicId: requirePublicId(data.customerId, "Customer is invalid"),
            businessId: bizId,
            isActive: true,
          },
          select: { id: true, publicId: true, name: true },
        });

        if (!customer) {
          throw new AppError(404, "Customer not found");
        }
      }

      const {
        lines,
        totals: { subtotal, discount, tax, total },
        vat,
      } = await priceSale(tx, bizId, data.items, data.discount, data.tax, {
        ...(options.pricesIncludeVat !== undefined && { pricesIncludeVat: options.pricesIncludeVat }),
      });
      const amountPaid = parseMoney(data.amountPaid ?? 0, "Amount paid");

      if (amountPaid < 0n) {
        throw new AppError(400, "Amount paid cannot be negative");
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
      const orderedProducts = aggregateByProduct(lines);

      const branchId =
        options.branchId ??
        (await tx.branch.findFirstOrThrow({ where: { businessId: bizId, isMain: true } })).id;

      // Quantity actually taken per product and any shortfall (offline sales only: the customer was already served).
      const taken = new Map<bigint, string>();
      const shortfalls: { productId: bigint; short: string }[] = [];
      for (const [productId, entry] of orderedProducts) {
        // Stock is taken from the selling branch only.
        if (data.offlineSoldAt) {
          const r = await takeBranchStockClamped(tx, bizId, branchId, productId, milliToString(entry.quantity));
          if (!r) throw new AppError(400, `Insufficient stock for product: ${entry.name}`);
          taken.set(productId, r.taken);
          if (Number(r.short) > 0) shortfalls.push({ productId, short: r.short });
        } else {
          await takeBranchStockOrFail(tx, bizId, branchId, productId, milliToString(entry.quantity), entry.name);
          taken.set(productId, milliToString(entry.quantity));
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
          branchId,
          salespersonId: BigInt(salespersonId),
          customerId: customer?.id ?? null,
          receiptNumber,
          subtotal: centsToString(subtotal),
          discount: centsToString(discount),
          tax: centsToString(tax),
          total: centsToString(total),
          pricesIncludeVat: vat.inclusive,
          amountPaid: centsToString(amountPaid),
          balanceDue: centsToString(balanceDue),
          paymentStatus,
          status: "completed",
          channel: saleChannel(data.channel),
          offlineSoldAt: data.offlineSoldAt ?? null,
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
              taxClass: l.rateBps !== undefined ? l.taxClass : null,
              taxRate: l.rateBps !== undefined ? centsToString(l.rateBps) : null,
            })),
          },
        },
        include: { items: { include: { product: { select: { publicId: true } } } } },
      });

      if (amountPaid > 0n) {
        const method = data.paymentMethod!.trim().toLowerCase();
        let reference: string | null;
        if (data.mpesaPaymentRequestId !== undefined && data.pesapalPaymentRequestId !== undefined) {
          throw new AppError(400, "A sale can be paid by one online payment request only");
        } else if (data.pesapalPaymentRequestId !== undefined) {
          reference = await claimPesapalRequest(tx, bizId, sale.id, method, amountPaid, data.pesapalPaymentRequestId);
        } else if (data.mpesaPaymentRequestId !== undefined) {
          reference = await claimMpesaRequest(tx, bizId, sale.id, method, amountPaid, data.mpesaPaymentRequestId);
        } else {
          reference = await checkedPaymentReference(tx, bizId, method, data.paymentReference);
          // Entering the receipt of an STK payment by hand (the customer paid but the sale was never completed)
          // settles that confirmed payment too, but only when the amount is exactly what Safaricom confirmed.
          if (method === "mpesa" && reference) {
            await tx.mpesaPaymentRequest.updateMany({
              where: { businessId: bizId, mpesaReceipt: reference, status: "paid", saleId: null, amountCents: amountPaid },
              data: { saleId: sale.id, updatedAt: new Date() },
            });
          }
        }
        await tx.payment.create({
          data: {
            businessId: bizId,
            saleId: sale.id,
            amount: centsToString(amountPaid),
            method,
            reference,
            notes: "Initial payment for sale",
            createdBy: BigInt(salespersonId),
          },
        });
      }

      for (const [productId] of orderedProducts) {
        const qty = taken.get(productId)!;
        if (Number(qty) <= 0) continue; // nothing was on the shelf to take: the shortfall row says so
        await tx.inventoryMovement.create({
          data: {
            businessId: bizId,
            branchId,
            productId,
            type: "OUT",
            quantity: qty,
            reference: `SALE-${sale.id.toString()}`,
            notes: `Stock sold${customer ? ` to ${customer.name}` : ""}${data.offlineSoldAt ? " (offline sale)" : ""}`,
          },
        });
      }
      for (const f of shortfalls) {
        await tx.offlineStockShortfall.create({ data: { businessId: bizId, branchId, productId: f.productId, saleId: sale.id, quantityShort: f.short } });
      }

      return { ...formatCreatedSale(sale, customer, false), stockShortfall: shortfalls.length > 0 };
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
        include: { items: { include: { product: { select: { publicId: true } } } }, customer: { select: { publicId: true, name: true } } },
      });
      if (existing) {
        return formatCreatedSale(existing, existing.customer ?? null, true);
      }
    }
    if (isMpesaClash(error)) throw new AppError(409, MPESA_CLASH_MESSAGE);
    throw error;
  }
}

/**
 * What a sale would come to, without recording anything. The POS shows these numbers so
 * that what the cashier sees (VAT included) is exactly what the server will record.
 */
export async function previewBusinessSale(
  businessId: bigint,
  data: { items: RawSaleItem[]; discount?: unknown; tax?: unknown }
) {
  return prisma.$transaction(async (tx) => {
    const { lines, totals, vat } = await priceSale(tx, businessId, data.items, data.discount, data.tax);
    return {
      vatRegistered: vat.registered,
      vatRate: vat.registered ? centsToString(vat.rateBps) : null,
      pricesIncludeVat: vat.inclusive,
      subtotal: centsToString(totals.subtotal),
      discount: centsToString(totals.discount),
      tax: centsToString(totals.tax),
      total: centsToString(totals.total),
      items: lines.map((l) => ({
        productId: l.productPublicId,
        productName: l.productName,
        taxClass: l.taxClass,
        discount: centsToString(l.discount),
        tax: centsToString(l.tax),
        total: centsToString(l.total),
      })),
    };
  });
}

/**
 * Uses a CONFIRMED M-PESA STK payment as a sale's payment. Runs inside the sale's own transaction, and the
 * conditional update is what stops two sales (or two tills) from spending the same payment twice.
 * Returns the reference to store on the payment row.
 */
async function claimMpesaRequest(tx: Tx, businessId: bigint, saleId: bigint, method: string, amountPaid: bigint, publicId: string): Promise<string> {
  if (method !== "mpesa") throw new AppError(400, "An M-PESA payment request can only be used with the M-Pesa payment method");
  if (typeof publicId !== "string" || !/^[0-9a-f-]{36}$/i.test(publicId)) throw new AppError(400, "Invalid M-PESA payment request id");
  const req = await tx.mpesaPaymentRequest.findFirst({ where: { publicId, businessId } });
  if (!req) throw new AppError(404, "M-PESA payment request not found");
  if (req.status !== "paid") throw new AppError(409, "That M-PESA payment has not been confirmed by Safaricom yet");
  if (req.amountCents !== amountPaid) {
    throw new AppError(409, `The confirmed M-PESA payment is KES ${centsToString(req.amountCents)}. Set Amount paid to exactly that.`);
  }
  const claimed = await tx.mpesaPaymentRequest.updateMany({ where: { id: req.id, saleId: null, status: "paid" }, data: { saleId, updatedAt: new Date() } });
  if (claimed.count !== 1) throw new AppError(409, "That M-PESA payment was already used for another sale");
  return req.mpesaReceipt ?? `STK-${req.publicId.slice(0, 8).toUpperCase()}`;
}

/**
 * Uses a confirmed Pesapal payment as a sale's payment. Same rules as M-PESA: only PAID, same business, exact amount,
 * and the conditional update makes sure two sales racing for one payment cannot both win.
 * A payment Pesapal has since flagged as reversed is refused.
 */
async function claimPesapalRequest(tx: Tx, businessId: bigint, saleId: bigint, method: string, amountPaid: bigint, publicId: string): Promise<string> {
  if (method !== "pesapal") throw new AppError(400, "A Pesapal payment request can only be used with the Pesapal payment method");
  if (typeof publicId !== "string" || !/^[0-9a-f-]{36}$/i.test(publicId)) throw new AppError(400, "Invalid Pesapal payment request id");
  const req = await tx.pesapalPaymentRequest.findFirst({ where: { publicId, businessId } });
  if (!req) throw new AppError(404, "Pesapal payment request not found");
  if (req.status !== "paid") throw new AppError(409, "That Pesapal payment has not been confirmed yet");
  if (req.reversalNoticedAt) throw new AppError(409, "Pesapal reported that payment as reversed. It cannot be used for a sale.");
  if (req.amountCents !== amountPaid) {
    throw new AppError(409, `The confirmed Pesapal payment is KES ${centsToString(req.amountCents)}. Set Amount paid to exactly that.`);
  }
  const claimed = await tx.pesapalPaymentRequest.updateMany({ where: { id: req.id, saleId: null, status: "paid", reversalNoticedAt: null }, data: { saleId, updatedAt: new Date() } });
  if (claimed.count !== 1) throw new AppError(409, "That Pesapal payment was already used for another sale");
  return req.confirmationCode ?? `PSP-${req.publicId.slice(0, 8).toUpperCase()}`;
}
