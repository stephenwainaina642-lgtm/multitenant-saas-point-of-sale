import prisma from "../lib/prisma.js";
import { addBranchStock } from "../branches/branch-stock.js";
import { AppError } from "../lib/errors.js";
import { centsToString, milliToString, parseMoney, parseQuantity } from "../lib/money.js";

/** Rows per upload: keeps one request small and its validation report readable. */
export const MAX_IMPORT_ROWS = 500;

const MAX_CENTS = 999_999_999_999n;
const MAX_MILLI = 999_999_999_999n;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type RowError = { row: number; field: string; message: string };
export type ImportResult = { dryRun: boolean; total: number; valid: number; created: number; errors: RowError[]; newCategories?: string[] };

type Raw = Record<string, unknown>;

function rowsOf(input: unknown): Raw[] {
  if (!Array.isArray(input) || input.length === 0) throw new AppError(400, "Provide at least one row to import");
  if (input.length > MAX_IMPORT_ROWS) throw new AppError(400, `Import at most ${MAX_IMPORT_ROWS} rows at a time`);
  return input.map((r) => (r && typeof r === "object" && !Array.isArray(r) ? (r as Raw) : {}));
}

/** Empty cells (spreadsheet blanks) count as "not given". */
function cell(row: Raw, key: string): string | undefined {
  const v = row[key];
  if (v === undefined || v === null) return undefined;
  const t = String(v).trim();
  return t === "" ? undefined : t;
}

class Collector {
  errors: RowError[] = [];
  constructor(private row: number) {}
  fail(field: string, message: string) { this.errors.push({ row: this.row, field, message }); }
  get count() { return this.errors.length; }
}

function text(c: Collector, row: Raw, key: string, label: string, max: number): string | null {
  const t = cell(row, key);
  if (t === undefined) return null;
  if (t.length > max) { c.fail(label, `must be at most ${max} characters`); return null; }
  return t;
}

function money(c: Collector, row: Raw, key: string, label: string, required: boolean): string | null {
  const t = cell(row, key);
  if (t === undefined) { if (required) c.fail(label, "is required"); return null; }
  try {
    const cents = parseMoney(t.replace(/,/g, ""), label);
    if (cents < 0n) { c.fail(label, "cannot be negative"); return null; }
    if (cents > MAX_CENTS) { c.fail(label, "is out of range"); return null; }
    return centsToString(cents);
  } catch (e) { c.fail(label, (e as Error).message.replace(new RegExp(`^${label}\\s*`, "i"), "")); return null; }
}

function qty(c: Collector, row: Raw, key: string, label: string): string | null {
  const t = cell(row, key);
  if (t === undefined) return null;
  try {
    const milli = parseQuantity(t.replace(/,/g, ""), label);
    if (milli < 0n) { c.fail(label, "cannot be negative"); return null; }
    if (milli > MAX_MILLI) { c.fail(label, "is out of range"); return null; }
    return milliToString(milli);
  } catch (e) { c.fail(label, (e as Error).message.replace(new RegExp(`^${label}\\s*`, "i"), "")); return null; }
}

// ---------------------------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------------------------

type ProductRow = {
  name: string; sku: string | null; barcode: string | null; description: string | null;
  costPrice: string; sellingPrice: string; stockQuantity: string; minimumStock: string; unitOfMeasure: string; taxClass: string; category: string | null;
};

export async function importProducts(businessId: bigint, userId: bigint, input: unknown, dryRun: boolean, branchId?: bigint): Promise<ImportResult> {
  const raw = rowsOf(input);
  const existing = await prisma.product.findMany({
    where: { businessId, isActive: true },
    select: { name: true, sku: true, barcode: true },
  });
  const taken = {
    name: new Set(existing.map((p) => p.name.toLowerCase())),
    sku: new Set(existing.filter((p) => p.sku).map((p) => p.sku!.toLowerCase())),
    barcode: new Set(existing.filter((p) => p.barcode).map((p) => p.barcode!.toLowerCase())),
  };
  // Also catch archived products: SKU and barcode are unique per business even when archived.
  const archived = await prisma.product.findMany({ where: { businessId, isActive: false }, select: { sku: true, barcode: true } });
  for (const p of archived) {
    if (p.sku) taken.sku.add(p.sku.toLowerCase());
    if (p.barcode) taken.barcode.add(p.barcode.toLowerCase());
  }

  const seen = { name: new Set<string>(), sku: new Set<string>(), barcode: new Set<string>() };
  const errors: RowError[] = [];
  const good: ProductRow[] = [];

  raw.forEach((row, i) => {
    const c = new Collector(i + 1);
    const name = text(c, row, "name", "Name", 255);
    if (!name && cell(row, "name") === undefined) c.fail("Name", "is required");
    const sku = text(c, row, "sku", "SKU", 100);
    const barcode = text(c, row, "barcode", "Barcode", 100);
    const description = text(c, row, "description", "Description", 2000);
    const unit = text(c, row, "unitOfMeasure", "Unit of measure", 50) ?? "piece";
    const category = text(c, row, "category", "Category", 150);
    const rawClass = (cell(row, "taxClass") ?? "standard").toLowerCase().replace(/[\s-]+/g, "_");
    const taxClass = ["standard", "zero_rated", "exempt"].includes(rawClass) ? rawClass : "standard";
    if (!["standard", "zero_rated", "exempt"].includes(rawClass)) c.fail("Tax class", "must be standard, zero_rated or exempt");
    const costPrice = money(c, row, "costPrice", "Cost price", false) ?? "0.00";
    const sellingPrice = money(c, row, "sellingPrice", "Selling price", true);
    const stockQuantity = qty(c, row, "stockQuantity", "Opening stock") ?? "0.000";
    const minimumStock = qty(c, row, "minimumStock", "Minimum stock") ?? "0.000";

    for (const [key, label, value] of [["name", "Name", name], ["sku", "SKU", sku], ["barcode", "Barcode", barcode]] as const) {
      if (!value) continue;
      const k = value.toLowerCase();
      if (taken[key].has(k)) c.fail(label, `"${value}" already exists in this business`);
      else if (seen[key].has(k)) c.fail(label, `"${value}" appears more than once in this file`);
      seen[key].add(k);
    }

    if (c.count) errors.push(...c.errors);
    else good.push({ name: name!, sku, barcode, description, costPrice, sellingPrice: sellingPrice!, stockQuantity, minimumStock, unitOfMeasure: unit, taxClass, category });
  });

  // Categories named in the file: existing ones are reused (any capitalisation), the rest are created on import.
  const known = await prisma.category.findMany({ where: { businessId }, select: { id: true, name: true } });
  const byName = new Map(known.map((k) => [k.name.toLowerCase(), k.id]));
  const newNames = new Map<string, string>();
  for (const p of good) {
    if (p.category && !byName.has(p.category.toLowerCase()) && !newNames.has(p.category.toLowerCase())) newNames.set(p.category.toLowerCase(), p.category);
  }

  const result: ImportResult = { dryRun, total: raw.length, valid: good.length, created: 0, errors, newCategories: [...newNames.values()] };
  // All or nothing: a file with any problem creates nothing, so it can simply be fixed and re-sent.
  if (dryRun || errors.length) return result;

  await prisma.$transaction(async (tx) => {
    for (const [key, name] of newNames) {
      byName.set(key, (await tx.category.create({ data: { businessId, name } })).id);
    }
    for (const { category, ...p } of good) {
      const product = await tx.product.create({
        data: { businessId, ...p, stockQuantity: "0.000", categoryId: category ? byName.get(category.toLowerCase()) ?? null : null, isActive: true },
      });
      if (Number(p.stockQuantity) > 0) {
        // Opening stock goes into the branch the import was run in (Main when none is given).
        const target = branchId ?? (await tx.branch.findFirstOrThrow({ where: { businessId, isMain: true } })).id;
        await addBranchStock(tx, businessId, target, product.id, p.stockQuantity);
        await tx.inventoryMovement.create({
          data: {
            businessId, branchId: target, productId: product.id, type: "IN", quantity: p.stockQuantity,
            reference: "OPENING-STOCK", notes: "Opening stock recorded by product import",
          },
        });
      }
    }
    await tx.auditLog.create({
      data: { businessId, userId, action: "product.import", entity: "product", details: { rows: good.length, newCategories: [...newNames.values()] } },
    });
  }, { timeout: 60_000 });
  result.created = good.length;
  return result;
}

// ---------------------------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------------------------

export async function importCustomers(businessId: bigint, userId: bigint, input: unknown, dryRun: boolean): Promise<ImportResult> {
  const raw = rowsOf(input);
  const existing = await prisma.customer.findMany({ where: { businessId, isActive: true }, select: { phone: true } });
  const phones = new Set(existing.filter((c) => c.phone).map((c) => c.phone!.replace(/\s+/g, "")));
  const seen = new Set<string>();
  const errors: RowError[] = [];
  const good: { name: string; phone: string | null; email: string | null; address: string | null; taxNumber: string | null; notes: string | null; creditLimit: string }[] = [];

  raw.forEach((row, i) => {
    const c = new Collector(i + 1);
    const name = text(c, row, "name", "Name", 255);
    if (!name && cell(row, "name") === undefined) c.fail("Name", "is required");
    const phone = text(c, row, "phone", "Phone", 50);
    const email = text(c, row, "email", "Email", 255);
    if (email && !EMAIL_PATTERN.test(email)) c.fail("Email", "is not a valid email address");
    const address = text(c, row, "address", "Address", 1000);
    const taxNumber = text(c, row, "taxNumber", "Tax number", 100);
    const notes = text(c, row, "notes", "Notes", 2000);
    const creditLimit = money(c, row, "creditLimit", "Credit limit", false) ?? "0.00";

    if (phone) {
      const key = phone.replace(/\s+/g, "");
      if (phones.has(key)) c.fail("Phone", `"${phone}" already belongs to a customer in this business`);
      else if (seen.has(key)) c.fail("Phone", `"${phone}" appears more than once in this file`);
      seen.add(key);
    }

    if (c.count) errors.push(...c.errors);
    else good.push({ name: name!, phone, email, address, taxNumber, notes, creditLimit });
  });

  const result: ImportResult = { dryRun, total: raw.length, valid: good.length, created: 0, errors };
  if (dryRun || errors.length) return result;

  await prisma.$transaction(async (tx) => {
    await tx.customer.createMany({ data: good.map((g) => ({ businessId, ...g })) });
    await tx.auditLog.create({
      data: { businessId, userId, action: "customer.import", entity: "customer", details: { rows: good.length } },
    });
  }, { timeout: 60_000 });
  result.created = good.length;
  return result;
}
