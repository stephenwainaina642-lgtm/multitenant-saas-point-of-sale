import prisma from "../lib/prisma.js";
import { AppError } from "../lib/errors.js";
import { centsToString, decimalToCents, parseMoney } from "../lib/money.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_CENTS = 999_999_999_999n;

export type SupplierData = {
  name?: unknown; phone?: unknown; email?: unknown; address?: unknown;
  notes?: unknown; taxNumber?: unknown;
};

function text(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new AppError(400, `${field} must be text`);
  const t = value.trim();
  if (t.length > max) throw new AppError(400, `${field} must be at most ${max} characters`);
  return t || null;
}

/** Validates the fields that were supplied; `partial` allows omitting the name. */
function parse(data: SupplierData, partial: boolean) {
  const out: Record<string, unknown> = {};
  if (data.name !== undefined || !partial) {
    const name = text(data.name, "Name", 255);
    if (!name) throw new AppError(400, "Supplier name is required");
    out.name = name;
  }
  if (data.phone !== undefined) out.phone = text(data.phone, "Phone", 50);
  if (data.email !== undefined) {
    const email = text(data.email, "Email", 255);
    if (email && !EMAIL_PATTERN.test(email)) throw new AppError(400, "Enter a valid email address");
    out.email = email;
  }
  if (data.address !== undefined) out.address = text(data.address, "Address", 1000);
  if (data.notes !== undefined) out.notes = text(data.notes, "Notes", 2000);
  if (data.taxNumber !== undefined) out.taxNumber = text(data.taxNumber, "Tax number", 100);

  return out;
}

function format(r: {
  id: bigint; name: string; phone: string | null; email: string | null; address: string | null;
  notes: string | null; taxNumber: string | null; balance: { toFixed(d: number): string };
  isActive: boolean; createdAt: Date;
}) {
  return {
    id: r.id.toString(), name: r.name, phone: r.phone, email: r.email, address: r.address,
    notes: r.notes, taxNumber: r.taxNumber, balance: r.balance.toFixed(2),
    isActive: r.isActive, createdAt: r.createdAt,
  };
}

async function findOwn(businessId: string, idText: string) {
  if (!/^[1-9]\d*$/.test(idText)) throw new AppError(400, "A valid supplier ID is required");
  const row = await prisma.supplier.findFirst({
    where: { id: BigInt(idText), businessId: BigInt(businessId), isActive: true },
  });
  if (!row) throw new AppError(404, "Supplier not found");
  return row;
}

export async function getBusinessSuppliers(businessId: string) {
  const rows = await prisma.supplier.findMany({
    where: { businessId: BigInt(businessId), isActive: true },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(format);
}

export async function createBusinessSupplier(businessId: string, data: SupplierData) {
  const fields = parse(data, false) as any;
  return format(await prisma.supplier.create({ data: { ...fields, businessId: BigInt(businessId) } }));
}

export async function updateBusinessSupplier(businessId: string, idText: string, data: SupplierData) {
  const row = await findOwn(businessId, idText);
  const fields = parse(data, true) as any;
  return format(await prisma.supplier.update({ where: { id: row.id }, data: fields }));
}

export async function deleteBusinessSupplier(businessId: string, idText: string) {
  const row = await findOwn(businessId, idText);
  if (decimalToCents(row.balance) !== 0n) {
    throw new AppError(409, "This supplier has an outstanding balance. Settle it before archiving");
  }
  const archived = await prisma.supplier.update({ where: { id: row.id }, data: { isActive: false } });
  return { id: archived.id.toString(), name: archived.name, isActive: archived.isActive };
}
