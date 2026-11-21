import prisma from "../lib/prisma.js";
import { requirePublicId } from "../lib/public-id.js";
import { AppError } from "../lib/errors.js";
import { decimalToCents } from "../lib/money.js";

const MAX_NUMBER_ATTEMPTS = 25;

export type CreateInvoiceData = {
  saleId?: unknown; invoiceNumber?: unknown; invoiceDate?: unknown; dueDate?: unknown; notes?: unknown;
};

const saleInclude = {
  customer: { select: { publicId: true, name: true, phone: true, email: true, address: true } },
  items: {
    orderBy: { id: "asc" as const },
    include: { product: { select: { id: true, publicId: true, name: true, sku: true, unitOfMeasure: true } } },
  },
};

/**
 * An invoice is a document about a sale. Its money figures, lines and status always come from the
 * sale as it stands now, so a later payment, edit or void is reflected immediately. (The copies
 * stored on the invoice row when it was created are history only and are never shown.)
 */
function present(invoice: any, sale: any) {
  const total = decimalToCents(sale.total);
  const paid = decimalToCents(sale.amountPaid);
  let status: string;
  if (sale.status === "voided") status = "void";
  else if (paid >= total) status = "paid";
  else if (invoice.dueDate && invoice.dueDate.getTime() < Date.now()) status = "overdue";
  else status = paid > 0n ? "partial" : "unpaid";

  return {
    id: invoice.id.toString(),
    invoiceNumber: invoice.invoiceNumber,
    saleId: sale.publicId,
    receiptNumber: sale.receiptNumber,
    customerId: sale.customer?.publicId ?? null,
    customerName: sale.customer?.name ?? null,
    customerPhone: sale.customer?.phone ?? null,
    customer: sale.customer
      ? {
          id: sale.customer.publicId, name: sale.customer.name, phone: sale.customer.phone,
          email: sale.customer.email, address: sale.customer.address,
        }
      : null,
    invoiceDate: invoice.invoiceDate,
    dueDate: invoice.dueDate,
    subtotal: sale.subtotal, discount: sale.discount, tax: sale.tax, total: sale.total,
    pricesIncludeVat: sale.pricesIncludeVat,
    amountPaid: sale.amountPaid, balanceDue: sale.status === "voided" ? "0" : sale.balanceDue,
    status,
    saleStatus: sale.status,
    notes: invoice.notes,
    items: sale.items.map((item: any) => ({
      id: item.id.toString(), productId: item.product.publicId, productName: item.product.name,
      sku: item.product.sku, unitOfMeasure: item.product.unitOfMeasure, quantity: item.quantity,
      unitPrice: item.unitPrice, discount: item.discount, tax: item.tax, total: item.total,
    })),
    createdAt: invoice.createdAt,
    updatedAt: invoice.updatedAt,
  };
}

export async function getBusinessInvoices(businessId: string) {
  const invoices = await prisma.invoice.findMany({
    where: { businessId: BigInt(businessId) },
    include: { sale: { include: saleInclude } },
    orderBy: [{ invoiceDate: "desc" }, { id: "desc" }],
  });
  return invoices.map((invoice) => present(invoice, invoice.sale));
}

export async function getBusinessInvoiceById(businessId: string, idText: string) {
  if (!/^[1-9]\d*$/.test(idText)) throw new AppError(404, "Invoice not found");
  const invoice = await prisma.invoice.findFirst({
    where: { id: BigInt(idText), businessId: BigInt(businessId) },
    include: { sale: { include: saleInclude } },
  });
  if (!invoice) throw new AppError(404, "Invoice not found");
  return present(invoice, invoice.sale);
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

export async function createBusinessInvoice(businessId: string, data: CreateInvoiceData, actorUserId?: string) {
  const bizId = BigInt(businessId);
  const salePublicId = requirePublicId(typeof data.saleId === "string" ? data.saleId.trim() : data.saleId, "A valid sale is required");

  let manualNumber: string | null = null;
  if (data.invoiceNumber !== undefined && data.invoiceNumber !== null && data.invoiceNumber !== "") {
    if (typeof data.invoiceNumber !== "string") throw new AppError(400, "Invalid invoice number");
    manualNumber = data.invoiceNumber.trim();
    if (!manualNumber || manualNumber.length > 100) throw new AppError(400, "Invoice number must be 1-100 characters");
  }
  const invoiceDate = parseDate(data.invoiceDate, "invoice date") ?? new Date();
  const dueDate = parseDate(data.dueDate, "due date");
  if (dueDate && dueDate.getTime() < invoiceDate.getTime() - 24 * 60 * 60 * 1000) {
    throw new AppError(400, "The due date cannot be before the invoice date");
  }
  let notes: string | null = null;
  if (data.notes !== undefined && data.notes !== null) {
    if (typeof data.notes !== "string" || data.notes.length > 2000) throw new AppError(400, "Notes must be text of at most 2000 characters");
    notes = data.notes.trim() || null;
  }

  const created = await prisma.$transaction(async (tx) => {
    const sale = await tx.sale.findFirst({
      where: { publicId: salePublicId, businessId: bizId },
      include: { ...saleInclude, invoice: { select: { id: true } } },
    });
    if (!sale) throw new AppError(404, "Sale not found");
    if (sale.status !== "completed") throw new AppError(409, "A voided sale cannot be invoiced");
    if (sale.invoice) throw new AppError(409, "This sale already has an invoice");
    if (sale.items.length === 0) throw new AppError(400, "Sale has no items");

    let invoiceNumber = manualNumber;
    if (invoiceNumber) {
      const clash = await tx.invoice.findFirst({ where: { businessId: bizId, invoiceNumber }, select: { id: true } });
      if (clash) throw new AppError(409, "Invoice number already exists");
    } else {
      // Next free sequential number (skips any numbers typed in by hand before).
      for (let attempt = 0; attempt < MAX_NUMBER_ATTEMPTS && !invoiceNumber; attempt++) {
        const [seq] = await tx.$queryRaw<{ n: bigint }[]>`
          INSERT INTO document_sequences (business_id, kind, next_value)
          VALUES (${bizId}, 'invoice', 2)
          ON CONFLICT (business_id, kind)
          DO UPDATE SET next_value = document_sequences.next_value + 1
          RETURNING next_value - 1 AS n`;
        const candidate = `INV-${seq!.n.toString().padStart(6, "0")}`;
        const clash = await tx.invoice.findFirst({ where: { businessId: bizId, invoiceNumber: candidate }, select: { id: true } });
        if (!clash) invoiceNumber = candidate;
      }
      if (!invoiceNumber) throw new AppError(500, "Could not allocate an invoice number");
    }

    const invoice = await tx.invoice.create({
      data: {
        businessId: bizId,
        customerId: sale.customerId,
        saleId: sale.id,
        invoiceNumber,
        invoiceDate,
        ...(dueDate && { dueDate }),
        subtotal: sale.subtotal, discount: sale.discount, tax: sale.tax, total: sale.total,
        amountPaid: sale.amountPaid, balanceDue: sale.balanceDue,
        status: "issued",
        notes: notes ?? sale.notes ?? null,
        items: {
          create: sale.items.map((item) => ({
            productId: item.productId, quantity: item.quantity, unitPrice: item.unitPrice,
            discount: item.discount, tax: item.tax, total: item.total,
          })),
        },
      },
    });
    await tx.auditLog.create({
      data: {
        businessId: bizId, userId: actorUserId ? BigInt(actorUserId) : null, action: "invoice.create",
        entity: "invoice", entityId: invoice.id, details: { invoiceNumber, saleId: sale.id.toString() },
      },
    });
    return invoice;
  }).catch((e: any) => {
    if (e?.code === "P2002") throw new AppError(409, "This sale already has an invoice, or the number is taken");
    throw e;
  });

  return getBusinessInvoiceById(businessId, created.id.toString());
}
