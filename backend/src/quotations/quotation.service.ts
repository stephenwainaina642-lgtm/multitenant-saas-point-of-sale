import prisma from "../lib/prisma.js";
import { AppError } from "../lib/errors.js";
import { requirePublicId } from "../lib/public-id.js";
import { centsToString, decimalToCents } from "../lib/money.js";
import { enteredSaleDiscount, priceSale, type RawSaleItem } from "../sales/sale-calc.js";
import { createBusinessSale } from "../sales/sale.service.js";

const MAX_NUMBER_ATTEMPTS = 25;
const DAY_MS = 24 * 60 * 60 * 1000;

export type QuotationData = {
  customerId?: unknown; quotationNumber?: unknown; quotationDate?: unknown; expiryDate?: unknown;
  discount?: unknown; tax?: unknown; notes?: unknown; items?: unknown;
};

const include = {
  customer: { select: { publicId: true, name: true, phone: true, email: true, address: true } },
  convertedSale: { select: { id: true, receiptNumber: true } },
  items: {
    orderBy: { id: "asc" as const },
    include: { product: { select: { id: true, publicId: true, name: true, sku: true, unitOfMeasure: true } } },
  },
};

/** "expired" is derived: an open quotation (draft or sent) past its expiry date. */
function effectiveStatus(q: { status: string; expiryDate: Date | null }) {
  if ((q.status === "draft" || q.status === "sent") && q.expiryDate && q.expiryDate.getTime() < Date.now()) {
    return "expired";
  }
  return q.status;
}

function present(q: any) {
  return {
    id: q.id.toString(),
    quotationNumber: q.quotationNumber,
    customerId: q.customer?.publicId ?? null,
    customerName: q.customer?.name ?? null,
    customer: q.customer
      ? { id: q.customer.publicId, name: q.customer.name, phone: q.customer.phone, email: q.customer.email, address: q.customer.address }
      : null,
    quotationDate: q.quotationDate,
    expiryDate: q.expiryDate,
    subtotal: q.subtotal, discount: q.discount, tax: q.tax, total: q.total,
    pricesIncludeVat: q.pricesIncludeVat, saleDiscount: centsToString(enteredSaleDiscount(q)),
    status: effectiveStatus(q),
    storedStatus: q.status,
    notes: q.notes,
    convertedSaleId: q.convertedSale?.id.toString() ?? null,
    convertedReceiptNumber: q.convertedSale?.receiptNumber ?? null,
    items: q.items.map((item: any) => ({
      id: item.id.toString(), productId: item.product.publicId, productName: item.product.name,
      sku: item.product.sku, unitOfMeasure: item.product.unitOfMeasure, quantity: item.quantity,
      unitPrice: item.unitPrice, discount: item.discount, tax: item.tax, total: item.total,
    })),
    createdAt: q.createdAt,
    updatedAt: q.updatedAt,
  };
}

function parseDate(value: unknown, field: string): Date | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new AppError(400, `Invalid ${field}`);
  const d = new Date(value);
  if (Number.isNaN(d.getTime()) || d.getUTCFullYear() < 2000 || d.getUTCFullYear() > 2100) {
    throw new AppError(400, `Invalid ${field}`);
  }
  return d;
}

function parseNotes(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string" || value.length > 2000) throw new AppError(400, "Notes must be text of at most 2000 characters");
  return value.trim() || null;
}

function parseItems(value: unknown): RawSaleItem[] {
  if (!Array.isArray(value) || value.length === 0) throw new AppError(400, "At least one quotation item is required");
  if (value.length > 200) throw new AppError(400, "A quotation can have at most 200 items");
  return value.map((raw) => {
    if (!raw || typeof raw !== "object") throw new AppError(400, "Invalid quotation item");
    const r = raw as Record<string, any>;
    return { productId: String(r.productId ?? ""), quantity: r.quantity, unitPrice: r.unitPrice, discount: r.discount, tax: r.tax };
  });
}

async function resolveCustomer(tx: any, businessId: bigint, value: unknown): Promise<bigint | null> {
  if (value === undefined || value === null || value === "") return null;
  const customer = await tx.customer.findFirst({ where: { publicId: requirePublicId(value, "Invalid customer"), businessId, isActive: true } });
  if (!customer) throw new AppError(404, "Customer not found");
  return customer.id;
}

async function nextNumber(tx: any, businessId: bigint): Promise<string> {
  for (let attempt = 0; attempt < MAX_NUMBER_ATTEMPTS; attempt++) {
    const [seq] = await tx.$queryRaw<{ n: bigint }[]>`
      INSERT INTO document_sequences (business_id, kind, next_value)
      VALUES (${businessId}, 'quotation', 2)
      ON CONFLICT (business_id, kind)
      DO UPDATE SET next_value = document_sequences.next_value + 1
      RETURNING next_value - 1 AS n`;
    const candidate = `QUO-${seq!.n.toString().padStart(6, "0")}`;
    const clash = await tx.quotation.findFirst({ where: { businessId, quotationNumber: candidate }, select: { id: true } });
    if (!clash) return candidate;
  }
  throw new AppError(500, "Could not allocate a quotation number");
}

function checkDates(date: Date, expiry: Date | null) {
  if (expiry && expiry.getTime() < date.getTime() - DAY_MS) {
    throw new AppError(400, "The expiry date cannot be before the quotation date");
  }
}

async function findOwn(businessId: string, idText: string) {
  if (!/^[1-9]\d*$/.test(idText)) throw new AppError(404, "Quotation not found");
  const q = await prisma.quotation.findFirst({ where: { id: BigInt(idText), businessId: BigInt(businessId) }, include });
  if (!q) throw new AppError(404, "Quotation not found");
  return q;
}

export async function getBusinessQuotations(businessId: string) {
  const rows = await prisma.quotation.findMany({
    where: { businessId: BigInt(businessId) }, include,
    orderBy: [{ quotationDate: "desc" }, { id: "desc" }],
  });
  return rows.map(present);
}

export async function getBusinessQuotationById(businessId: string, idText: string) {
  return present(await findOwn(businessId, idText));
}

export async function createBusinessQuotation(businessId: string, data: QuotationData, actorUserId?: string) {
  const bizId = BigInt(businessId);
  const items = parseItems(data.items);
  const quotationDate = parseDate(data.quotationDate, "quotation date") ?? new Date();
  const expiryDate = parseDate(data.expiryDate, "expiry date");
  checkDates(quotationDate, expiryDate);
  const notes = parseNotes(data.notes);

  let manualNumber: string | null = null;
  if (data.quotationNumber !== undefined && data.quotationNumber !== null && data.quotationNumber !== "") {
    if (typeof data.quotationNumber !== "string") throw new AppError(400, "Invalid quotation number");
    manualNumber = data.quotationNumber.trim();
    if (!manualNumber || manualNumber.length > 100) throw new AppError(400, "Quotation number must be 1-100 characters");
  }

  const created = await prisma.$transaction(async (tx) => {
    const customerId = await resolveCustomer(tx, bizId, data.customerId);
    const { lines, totals, vat } = await priceSale(tx, bizId, items, data.discount, data.tax);

    let quotationNumber = manualNumber;
    if (quotationNumber) {
      const clash = await tx.quotation.findFirst({ where: { businessId: bizId, quotationNumber }, select: { id: true } });
      if (clash) throw new AppError(409, "Quotation number already exists");
    } else {
      quotationNumber = await nextNumber(tx, bizId);
    }

    const q = await tx.quotation.create({
      data: {
        businessId: bizId, customerId, quotationNumber, quotationDate,
        ...(expiryDate && { expiryDate }),
        subtotal: centsToString(totals.subtotal), discount: centsToString(totals.discount),
        tax: centsToString(totals.tax), total: centsToString(totals.total), pricesIncludeVat: vat.inclusive,
        status: "draft", notes: notes ?? null,
        items: {
          create: lines.map((l) => ({
            productId: l.productId, quantity: Number(l.quantity) / 1000, unitPrice: centsToString(l.unitPrice),
            discount: centsToString(l.discount), tax: centsToString(l.tax), total: centsToString(l.total),
          })),
        },
      },
    });
    await tx.auditLog.create({
      data: {
        businessId: bizId, userId: actorUserId ? BigInt(actorUserId) : null, action: "quotation.create",
        entity: "quotation", entityId: q.id, details: { quotationNumber, total: centsToString(totals.total) },
      },
    });
    return q;
  }).catch((e: any) => {
    if (e?.code === "P2002") throw new AppError(409, "Quotation number already exists");
    throw e;
  });

  return getBusinessQuotationById(businessId, created.id.toString());
}

/** Draft and sent quotations can be edited; anything decided or converted is history. */
export async function updateBusinessQuotation(businessId: string, idText: string, data: QuotationData, actorUserId?: string) {
  const bizId = BigInt(businessId);
  const before = await findOwn(businessId, idText);
  if (before.status !== "draft" && before.status !== "sent") {
    throw new AppError(409, `A ${before.status} quotation can no longer be edited`);
  }
  const items = parseItems(data.items);
  const quotationDate = parseDate(data.quotationDate, "quotation date") ?? before.quotationDate;
  const expiryDate = data.expiryDate === undefined ? before.expiryDate : parseDate(data.expiryDate, "expiry date");
  checkDates(quotationDate, expiryDate);
  const notes = parseNotes(data.notes);

  await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ status: string }[]>`
      SELECT status FROM quotations WHERE id = ${before.id} AND business_id = ${bizId} FOR UPDATE`;
    if (locked[0]?.status !== "draft" && locked[0]?.status !== "sent") {
      throw new AppError(409, "This quotation can no longer be edited");
    }
    const customerId = data.customerId === undefined ? before.customerId : await resolveCustomer(tx, bizId, data.customerId);
    const { lines, totals, vat } = await priceSale(tx, bizId, items, data.discount, data.tax);

    await tx.quotationItem.deleteMany({ where: { quotationId: before.id } });
    await tx.quotation.update({
      where: { id: before.id },
      data: {
        customerId, quotationDate, expiryDate,
        ...(notes !== undefined && { notes }),
        subtotal: centsToString(totals.subtotal), discount: centsToString(totals.discount),
        tax: centsToString(totals.tax), total: centsToString(totals.total), pricesIncludeVat: vat.inclusive, updatedAt: new Date(),
        items: {
          create: lines.map((l) => ({
            productId: l.productId, quantity: Number(l.quantity) / 1000, unitPrice: centsToString(l.unitPrice),
            discount: centsToString(l.discount), tax: centsToString(l.tax), total: centsToString(l.total),
          })),
        },
      },
    });
    await tx.auditLog.create({
      data: {
        businessId: bizId, userId: actorUserId ? BigInt(actorUserId) : null, action: "quotation.update",
        entity: "quotation", entityId: before.id,
        details: { before: { total: before.total.toFixed(2), items: before.items.length }, after: { total: centsToString(totals.total), items: lines.length } },
      },
    });
  });
  return getBusinessQuotationById(businessId, idText);
}

const TRANSITIONS: Record<string, string[]> = {
  draft: ["sent", "accepted", "rejected"],
  sent: ["accepted", "rejected"],
};

export async function setQuotationStatus(businessId: string, idText: string, status: unknown, actorUserId?: string) {
  const bizId = BigInt(businessId);
  if (typeof status !== "string" || !["sent", "accepted", "rejected"].includes(status)) {
    throw new AppError(400, "Status must be one of: sent, accepted, rejected");
  }
  const q = await findOwn(businessId, idText);
  if (effectiveStatus(q) === "expired") throw new AppError(409, "This quotation has expired. Edit its expiry date first");
  if (!TRANSITIONS[q.status]?.includes(status)) {
    throw new AppError(409, `A ${q.status} quotation cannot be marked ${status}`);
  }
  await prisma.$transaction(async (tx) => {
    const changed = await tx.quotation.updateMany({
      where: { id: q.id, businessId: bizId, status: q.status },
      data: { status, updatedAt: new Date() },
    });
    if (changed.count === 0) throw new AppError(409, "The quotation changed while you were editing it. Reload and try again");
    await tx.auditLog.create({
      data: {
        businessId: bizId, userId: actorUserId ? BigInt(actorUserId) : null, action: "quotation.status",
        entity: "quotation", entityId: q.id, details: { from: q.status, to: status },
      },
    });
  });
  return getBusinessQuotationById(businessId, idText);
}

/** Turns an accepted quotation into a real sale (stock, balance and receipt number follow the normal rules). */
export async function convertQuotationToSale(
  businessId: string, idText: string,
  data: { amountPaid?: unknown; paymentMethod?: unknown; paymentReference?: unknown },
  actor: { userId: string }
) {
  const bizId = BigInt(businessId);
  const q = await findOwn(businessId, idText);
  if (q.convertedSaleId) throw new AppError(409, `This quotation was already converted to sale ${q.convertedSale?.receiptNumber}`);
  if (q.status !== "accepted") throw new AppError(409, "Only an accepted quotation can be converted to a sale");

  // Convert in the mode the quotation was priced in, so the sale total matches what the customer was quoted.
  const saleDiscount = enteredSaleDiscount(q);
  const lineTax = q.items.reduce((t, i) => t + decimalToCents(i.tax), 0n);
  const saleTax = q.pricesIncludeVat ? 0n : decimalToCents(q.tax) - lineTax;

  let sale: any;
  try {
    sale = await createBusinessSale(
      businessId, actor.userId,
      {
        ...(q.customer && { customerId: q.customer.publicId }),
        discount: Number(centsToString(saleDiscount < 0n ? 0n : saleDiscount)),
        tax: Number(centsToString(saleTax < 0n ? 0n : saleTax)),
        ...(data.amountPaid !== undefined && { amountPaid: Number(data.amountPaid) }),
        ...(typeof data.paymentMethod === "string" && { paymentMethod: data.paymentMethod }),
        ...(typeof data.paymentReference === "string" && { paymentReference: data.paymentReference }),
        notes: `From quotation ${q.quotationNumber}`,
        items: q.items.map((i) => ({
          productId: i.product.publicId, quantity: Number(i.quantity), unitPrice: Number(i.unitPrice),
          discount: Number(i.discount), tax: Number(i.tax),
        })),
      },
      { idempotencyKey: `quotation-${q.id}`, pricesIncludeVat: q.pricesIncludeVat }
    );
  } catch (e) {
    if (e instanceof AppError && /does not match the saved selling price/.test(e.message)) {
      throw new AppError(409, `${e.message}. Prices changed since this quotation was made; create a new quotation`);
    }
    throw e;
  }

  await prisma.$transaction(async (tx) => {
    await tx.quotation.updateMany({
      where: { id: q.id, businessId: bizId, convertedSaleId: null },
      data: { status: "converted", convertedSaleId: BigInt(sale.id), updatedAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        businessId: bizId, userId: BigInt(actor.userId), action: "quotation.convert",
        entity: "quotation", entityId: q.id, details: { saleId: sale.id, receiptNumber: sale.receiptNumber },
      },
    });
  });

  return { quotation: await getBusinessQuotationById(businessId, idText), sale };
}
