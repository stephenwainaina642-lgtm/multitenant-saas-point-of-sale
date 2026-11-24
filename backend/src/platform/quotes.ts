import prisma from "../lib/prisma.js";
import { Prisma } from "../generated/prisma/client.js";
import { AppError } from "../lib/errors.js";
import { centsToString, decimalToCents, lineAmount, milliToString, parseMoney, parseQuantity } from "../lib/money.js";
import { requirePublicId } from "../lib/public-id.js";

/**
 * Super-admin quotations for installations, trainings and other services.
 * Totals are worked out here in whole cents (never trusted from the browser). A quote is a draft until it is sent; a sent
 * quote is locked (company details are frozen on it) and is then accepted or declined. Every change is written to the
 * platform activity log.
 */

export const CATEGORIES = ["installation", "training", "subscription", "hardware", "support", "other"] as const;
type Category = (typeof CATEGORIES)[number];

const MAX_ITEMS = 50;
const MAX_UNIT_CENTS = 100_000_000_00n; // 100,000,000.00
const MAX_QTY_MILLI = 100_000_000n; // 100,000
const MAX_TOTAL_CENTS = 999_999_999_999n; // the column holds up to 9,999,999,999.99

// ---------- small validators ----------
const text = (v: unknown, max: number, label: string, required = false): string => {
  if (v === undefined || v === null) {
    if (required) throw new AppError(400, `${label} is required`);
    return "";
  }
  if (typeof v !== "string") throw new AppError(400, `${label} must be text`);
  const t = v.trim();
  if (required && !t) throw new AppError(400, `${label} is required`);
  if (t.length > max) throw new AppError(400, `${label} must be at most ${max} characters`);
  return t;
};
const emailOrBlank = (v: unknown, label: string) => {
  const t = text(v, 255, label);
  if (t && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) throw new AppError(400, `${label} is not a valid email address`);
  return t;
};
/** "16" / 16 / "16.5" -> percent string with 2 decimals and basis points, 0..50. */
const percent = (v: unknown, label: string) => {
  const n = typeof v === "string" ? Number(v.trim()) : Number(v);
  if (v === "" || v === null || !Number.isFinite(n) || n < 0 || n > 50 || Math.round(n * 100) / 100 !== n) throw new AppError(400, `${label} must be a percentage from 0 to 50, with at most 2 decimals`);
  return { str: n.toFixed(2), bps: BigInt(Math.round(n * 100)) };
};
const category = (v: unknown): Category => {
  if (v === undefined || v === null || v === "") return "other";
  if (typeof v !== "string" || !(CATEGORIES as readonly string[]).includes(v)) throw new AppError(400, `Category must be one of: ${CATEGORIES.join(", ")}`);
  return v as Category;
};

/** Today in Kenya as YYYY-MM-DD. */
const todayNairobi = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const addDays = (ymd: string, days: number) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const ymd = (v: unknown, label: string) => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`)) || new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) !== v) throw new AppError(400, `${label} must be a date (YYYY-MM-DD)`);
  return v;
};
const dateOnly = (d: Date) => d.toISOString().slice(0, 10);

// ---------- totals ----------
type ItemInput = { category: Category; description: string; details: string; qtyMilli: bigint; unitCents: bigint };
function parseItems(raw: unknown): ItemInput[] {
  if (!Array.isArray(raw)) throw new AppError(400, "Items must be a list");
  if (raw.length > MAX_ITEMS) throw new AppError(400, `A quotation can have at most ${MAX_ITEMS} lines`);
  return raw.map((r, i) => {
    const o = (r ?? {}) as Record<string, unknown>;
    const n = `Line ${i + 1}`;
    const qtyMilli = parseQuantity(o.quantity, `${n} quantity`);
    if (qtyMilli <= 0n || qtyMilli % 10n !== 0n || qtyMilli > MAX_QTY_MILLI) throw new AppError(400, `${n} quantity must be more than 0, with at most 2 decimals`);
    const unitCents = parseMoney(o.unitPrice, `${n} price`);
    if (unitCents < 0n || unitCents > MAX_UNIT_CENTS) throw new AppError(400, `${n} price is not valid`);
    return { category: category(o.category), description: text(o.description, 200, `${n} description`, true), details: text(o.details, 1000, `${n} details`), qtyMilli, unitCents };
  });
}
function totalsOf(items: ItemInput[], discountRaw: unknown, bps: bigint) {
  const lines = items.map((i) => lineAmount(i.qtyMilli, i.unitCents));
  const subtotal = lines.reduce((s, c) => s + c, 0n);
  const discount = discountRaw === undefined || discountRaw === null || discountRaw === "" ? 0n : parseMoney(discountRaw, "Discount");
  if (discount < 0n) throw new AppError(400, "Discount cannot be negative");
  if (discount > subtotal) throw new AppError(400, "Discount cannot be more than the subtotal");
  const base = subtotal - discount;
  const vat = (base * bps + 5000n) / 10000n; // half up
  if (subtotal + vat > MAX_TOTAL_CENTS) throw new AppError(400, "The total is too large");
  return { lines, subtotal, discount, vat, total: base + vat };
}

// ---------- settings ----------
const settingsOut = (s: Awaited<ReturnType<typeof loadSettings>>) => ({
  companyName: s.companyName, address: s.address, phone: s.phone, email: s.email, kraPin: s.kraPin, paymentDetails: s.paymentDetails,
  defaultTerms: s.defaultTerms, defaultValidityDays: s.defaultValidityDays, defaultVatRate: Number(s.defaultVatRate.toString()).toFixed(2),
});
const loadSettings = () => prisma.platformQuoteSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
export async function getSettings() { return settingsOut(await loadSettings()); }
export async function updateSettings(adminId: bigint, b: Record<string, unknown>) {
  const data: Record<string, unknown> = {};
  if (b.companyName !== undefined) data.companyName = text(b.companyName, 150, "Company name");
  if (b.address !== undefined) data.address = text(b.address, 300, "Address");
  if (b.phone !== undefined) data.phone = text(b.phone, 40, "Phone");
  if (b.email !== undefined) data.email = emailOrBlank(b.email, "Email");
  if (b.kraPin !== undefined) data.kraPin = text(b.kraPin, 20, "KRA PIN");
  if (b.paymentDetails !== undefined) data.paymentDetails = text(b.paymentDetails, 2000, "Payment details");
  if (b.defaultTerms !== undefined) data.defaultTerms = text(b.defaultTerms, 4000, "Terms");
  if (b.defaultValidityDays !== undefined) {
    const d = Number(b.defaultValidityDays);
    if (!Number.isInteger(d) || d < 1 || d > 365) throw new AppError(400, "Validity must be a whole number of days from 1 to 365");
    data.defaultValidityDays = d;
  }
  if (b.defaultVatRate !== undefined) data.defaultVatRate = percent(b.defaultVatRate, "VAT rate").str;
  if (Object.keys(data).length === 0) throw new AppError(400, "Nothing to change");
  await prisma.$transaction([
    prisma.platformQuoteSettings.upsert({ where: { id: 1 }, update: { ...data, updatedAt: new Date() }, create: { id: 1, ...data } }),
    prisma.platformAuditLog.create({ data: { adminId, action: "quote.settings", reason: "Quotation company details or defaults changed", details: { fields: Object.keys(data) } } }),
  ]);
  return getSettings();
}

// ---------- shaping ----------
type QuoteRow = NonNullable<Awaited<ReturnType<typeof findQuote>>>;
const findQuote = (publicId: string) => prisma.platformQuote.findUnique({ where: { publicId }, include: { items: { orderBy: { position: "asc" } }, admin: { select: { name: true } } } });

async function present(q: QuoteRow) {
  const frozen = q.issuer as Record<string, string> | null;
  const live = frozen ?? (({ companyName, address, phone, email, kraPin }) => ({ companyName, address, phone, email, kraPin }))(await loadSettings());
  const expired = q.status === "sent" && dateOnly(q.validUntil) < todayNairobi();
  return {
    id: q.publicId, number: q.quoteNumber, status: q.status, expired, title: q.title,
    client: { name: q.clientName, business: q.clientBusiness, email: q.clientEmail, phone: q.clientPhone, address: q.clientAddress, kraPin: q.clientKraPin },
    intro: q.intro, validUntil: dateOnly(q.validUntil), vatRate: Number(q.vatRate.toString()).toFixed(2),
    discount: q.discount.toFixed(2), subtotal: q.subtotal.toFixed(2), vatAmount: q.vatAmount.toFixed(2), total: q.total.toFixed(2),
    terms: q.terms, paymentDetails: q.paymentDetails, internalNotes: q.internalNotes,
    issuer: live, issuerFrozen: !!frozen,
    createdBy: q.admin.name, createdAt: q.createdAt, sentAt: q.sentAt, decidedAt: q.decidedAt,
    items: q.items.map((i) => ({ category: i.category, description: i.description, details: i.details, quantity: i.quantity.toFixed(2), unitPrice: i.unitPrice.toFixed(2), lineTotal: i.lineTotal.toFixed(2) })),
  };
}

const audit = (adminId: bigint, action: string, q: { quoteNumber: string; total?: unknown }, extra: Record<string, unknown> = {}) =>
  prisma.platformAuditLog.create({ data: { adminId, action, reason: `Quotation ${q.quoteNumber}`, details: { quote: q.quoteNumber, ...extra } } });

// ---------- reads ----------
export async function listQuotes(opts: { status?: string; q?: string }) {
  const status = opts.status && ["draft", "sent", "accepted", "declined"].includes(opts.status) ? opts.status : undefined;
  const search = (opts.q ?? "").trim().slice(0, 100);
  const rows = await prisma.platformQuote.findMany({
    where: {
      ...(status && { status }),
      ...(search && { OR: [{ quoteNumber: { contains: search, mode: "insensitive" } }, { clientName: { contains: search, mode: "insensitive" } }, { clientBusiness: { contains: search, mode: "insensitive" } }, { title: { contains: search, mode: "insensitive" } }] }),
    },
    orderBy: { createdAt: "desc" }, take: 300,
  });
  const today = todayNairobi();
  return rows.map((q) => ({
    id: q.publicId, number: q.quoteNumber, status: q.status, expired: q.status === "sent" && dateOnly(q.validUntil) < today,
    title: q.title, clientName: q.clientName, clientBusiness: q.clientBusiness, validUntil: dateOnly(q.validUntil), total: q.total.toFixed(2), createdAt: q.createdAt, sentAt: q.sentAt,
  }));
}
export async function getQuote(idText: string) {
  const q = await findQuote(requirePublicId(idText, "Invalid quotation"));
  if (!q) throw new AppError(404, "Quotation not found");
  return present(q);
}

// ---------- create / edit ----------
async function fields(b: Record<string, unknown>, defaults: Awaited<ReturnType<typeof loadSettings>> | null) {
  const items = parseItems(b.items ?? []);
  const vat = b.vatRate !== undefined ? percent(b.vatRate, "VAT rate") : percent(defaults?.defaultVatRate.toString() ?? "0", "VAT rate");
  const t = totalsOf(items, b.discount, vat.bps);
  const today = todayNairobi();
  const validUntil = b.validUntil !== undefined ? ymd(b.validUntil, "Valid until") : addDays(today, defaults?.defaultValidityDays ?? 14);
  return {
    items, t, vat,
    data: {
      title: text(b.title, 150, "Title"),
      clientName: text(b.clientName, 150, "Client name", true),
      clientBusiness: text(b.clientBusiness, 150, "Client business"),
      clientEmail: emailOrBlank(b.clientEmail, "Client email"),
      clientPhone: text(b.clientPhone, 40, "Client phone"),
      clientAddress: text(b.clientAddress, 300, "Client address"),
      clientKraPin: text(b.clientKraPin, 20, "Client KRA PIN"),
      intro: text(b.intro, 2000, "Introduction"),
      validUntil: new Date(`${validUntil}T00:00:00Z`),
      vatRate: vat.str, discount: centsToString(t.discount), subtotal: centsToString(t.subtotal), vatAmount: centsToString(t.vat), total: centsToString(t.total),
      terms: b.terms !== undefined ? text(b.terms, 4000, "Terms") : defaults?.defaultTerms ?? "",
      paymentDetails: b.paymentDetails !== undefined ? text(b.paymentDetails, 2000, "Payment details") : defaults?.paymentDetails ?? "",
      internalNotes: text(b.internalNotes, 2000, "Internal notes"),
    },
  };
}
const itemRows = (items: ItemInput[], lines: bigint[]) => items.map((i, n) => ({
  position: n + 1, category: i.category, description: i.description, details: i.details,
  quantity: milliToString(i.qtyMilli), unitPrice: centsToString(i.unitCents), lineTotal: centsToString(lines[n]!),
}));

async function nextNumber(tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) {
  const year = Number(todayNairobi().slice(0, 4));
  const rows = await tx.$queryRaw<{ last_seq: number }[]>`
    INSERT INTO platform_quote_counters (year, last_seq) VALUES (${year}, 1)
    ON CONFLICT (year) DO UPDATE SET last_seq = platform_quote_counters.last_seq + 1
    RETURNING last_seq`;
  return `QT-${year}-${String(rows[0]!.last_seq).padStart(4, "0")}`;
}

export async function createQuote(adminId: bigint, b: Record<string, unknown>) {
  const defaults = await loadSettings();
  const f = await fields(b, defaults);
  const id = await prisma.$transaction(async (tx) => {
    const quoteNumber = await nextNumber(tx);
    const q = await tx.platformQuote.create({ data: { ...f.data, quoteNumber, createdByAdminId: adminId, items: { create: itemRows(f.items, f.t.lines) } } });
    await tx.platformAuditLog.create({ data: { adminId, action: "quote.create", reason: `Quotation ${quoteNumber}`, details: { quote: quoteNumber, total: f.data.total } } });
    return q.publicId;
  });
  return getQuote(id);
}

async function mustBe(publicId: string, status: string) {
  const q = await prisma.platformQuote.findUnique({ where: { publicId } });
  if (!q) throw new AppError(404, "Quotation not found");
  if (q.status !== status) throw new AppError(409, `This quotation is ${q.status}${status === "draft" ? ". Reopen it to edit." : ""}`);
  return q;
}

export async function updateQuote(adminId: bigint, idText: string, b: Record<string, unknown>) {
  const publicId = requirePublicId(idText, "Invalid quotation");
  const current = await mustBe(publicId, "draft");
  const f = await fields({ vatRate: current.vatRate.toString(), ...b }, null);
  await prisma.$transaction(async (tx) => {
    const done = await tx.platformQuote.updateMany({ where: { id: current.id, status: "draft" }, data: { ...f.data, updatedAt: new Date() } });
    if (done.count !== 1) throw new AppError(409, "This quotation changed. Reload and try again.");
    await tx.platformQuoteItem.deleteMany({ where: { quoteId: current.id } });
    await tx.platformQuoteItem.createMany({ data: itemRows(f.items, f.t.lines).map((r) => ({ ...r, quoteId: current.id })) });
    await tx.platformAuditLog.create({ data: { adminId, action: "quote.edit", reason: `Quotation ${current.quoteNumber}`, details: { quote: current.quoteNumber, total: f.data.total } } });
  });
  return getQuote(publicId);
}

// ---------- status flow ----------
export async function sendQuote(adminId: bigint, idText: string) {
  const publicId = requirePublicId(idText, "Invalid quotation");
  const q = await mustBe(publicId, "draft");
  const items = await prisma.platformQuoteItem.count({ where: { quoteId: q.id } });
  if (items === 0) throw new AppError(400, "Add at least one line before sending");
  if (dateOnly(q.validUntil) < todayNairobi()) throw new AppError(400, "The valid-until date has passed. Choose a later date.");
  const s = await loadSettings();
  if (!s.companyName.trim()) throw new AppError(400, "Set your company details (name, contact, payment details) in Quotation settings before sending");
  const issuer = { companyName: s.companyName, address: s.address, phone: s.phone, email: s.email, kraPin: s.kraPin };
  await prisma.$transaction(async (tx) => {
    const done = await tx.platformQuote.updateMany({ where: { id: q.id, status: "draft" }, data: { status: "sent", sentAt: new Date(), issuer, updatedAt: new Date() } });
    if (done.count !== 1) throw new AppError(409, "This quotation changed. Reload and try again.");
    await tx.platformAuditLog.create({ data: { adminId, action: "quote.send", reason: `Quotation ${q.quoteNumber}`, details: { quote: q.quoteNumber, total: q.total.toString() } } });
  });
  return getQuote(publicId);
}

async function decide(adminId: bigint, idText: string, to: "accepted" | "declined") {
  const publicId = requirePublicId(idText, "Invalid quotation");
  const q = await mustBe(publicId, "sent");
  if (to === "accepted" && dateOnly(q.validUntil) < todayNairobi()) throw new AppError(409, "This quotation has expired. Duplicate it to issue a fresh one.");
  await prisma.$transaction(async (tx) => {
    const done = await tx.platformQuote.updateMany({ where: { id: q.id, status: "sent" }, data: { status: to, decidedAt: new Date(), updatedAt: new Date() } });
    if (done.count !== 1) throw new AppError(409, "This quotation changed. Reload and try again.");
    await tx.platformAuditLog.create({ data: { adminId, action: `quote.${to}`, reason: `Quotation ${q.quoteNumber}`, details: { quote: q.quoteNumber, total: q.total.toString() } } });
  });
  return getQuote(publicId);
}
export const acceptQuote = (adminId: bigint, id: string) => decide(adminId, id, "accepted");
export const declineQuote = (adminId: bigint, id: string) => decide(adminId, id, "declined");

/** A sent quote that is not yet decided can be pulled back to a draft for changes (recorded in the activity log). */
export async function reopenQuote(adminId: bigint, idText: string) {
  const publicId = requirePublicId(idText, "Invalid quotation");
  const q = await mustBe(publicId, "sent");
  await prisma.$transaction(async (tx) => {
    const done = await tx.platformQuote.updateMany({ where: { id: q.id, status: "sent" }, data: { status: "draft", sentAt: null, issuer: Prisma.DbNull, updatedAt: new Date() } });
    if (done.count !== 1) throw new AppError(409, "This quotation changed. Reload and try again.");
    await tx.platformAuditLog.create({ data: { adminId, action: "quote.reopen", reason: `Quotation ${q.quoteNumber}`, details: { quote: q.quoteNumber } } });
  });
  return getQuote(publicId);
}

/** A copy as a fresh draft with a new number (to revise an expired, declined or accepted quote). */
export async function duplicateQuote(adminId: bigint, idText: string) {
  const src = await findQuote(requirePublicId(idText, "Invalid quotation"));
  if (!src) throw new AppError(404, "Quotation not found");
  const defaults = await loadSettings();
  const items = src.items.map((i) => ({ category: i.category, description: i.description, details: i.details, quantity: i.quantity.toString(), unitPrice: i.unitPrice.toString() }));
  return createQuote(adminId, {
    title: src.title, clientName: src.clientName, clientBusiness: src.clientBusiness, clientEmail: src.clientEmail, clientPhone: src.clientPhone, clientAddress: src.clientAddress, clientKraPin: src.clientKraPin,
    intro: src.intro, vatRate: src.vatRate.toString(), discount: src.discount.toString(), terms: src.terms, paymentDetails: src.paymentDetails, internalNotes: src.internalNotes, items,
    validUntil: addDays(todayNairobi(), defaults.defaultValidityDays),
  });
}

export async function deleteQuote(adminId: bigint, idText: string) {
  const publicId = requirePublicId(idText, "Invalid quotation");
  const q = await mustBe(publicId, "draft");
  await prisma.$transaction(async (tx) => {
    const done = await tx.platformQuote.deleteMany({ where: { id: q.id, status: "draft" } });
    if (done.count !== 1) throw new AppError(409, "This quotation changed. Reload and try again.");
    await tx.platformAuditLog.create({ data: { adminId, action: "quote.delete", reason: `Draft quotation ${q.quoteNumber} deleted`, details: { quote: q.quoteNumber } } });
  });
}

// ---------- price list ----------
const serviceOut = (s: { publicId: string; name: string; category: string; description: string; unit: string; unitPrice: { toString(): string } }) =>
  ({ id: s.publicId, name: s.name, category: s.category, description: s.description, unit: s.unit, unitPrice: centsToString(decimalToCents(s.unitPrice.toString())) });
export async function listServices() { return (await prisma.platformQuoteService.findMany({ orderBy: [{ category: "asc" }, { name: "asc" }] })).map(serviceOut); }
function serviceData(b: Record<string, unknown>, partial: boolean) {
  const d: Record<string, unknown> = {};
  if (!partial || b.name !== undefined) d.name = text(b.name, 150, "Name", true);
  if (!partial || b.category !== undefined) d.category = category(b.category);
  if (b.description !== undefined) d.description = text(b.description, 1000, "Description");
  if (b.unit !== undefined) d.unit = text(b.unit, 30, "Unit") || "each";
  if (!partial || b.unitPrice !== undefined) {
    const c = parseMoney(b.unitPrice ?? 0, "Price");
    if (c < 0n || c > MAX_UNIT_CENTS) throw new AppError(400, "Price is not valid");
    d.unitPrice = centsToString(c);
  }
  return d;
}
const dup = (e: unknown) => { if ((e as { code?: string }).code === "P2002") throw new AppError(409, "There is already a service with that name"); throw e; };
export async function createService(adminId: bigint, b: Record<string, unknown>) {
  try {
    const s = await prisma.platformQuoteService.create({ data: serviceData(b, false) as never });
    await prisma.platformAuditLog.create({ data: { adminId, action: "quote.service.create", reason: `Price list: ${s.name}`, details: { name: s.name } } });
    return serviceOut(s);
  } catch (e) { return dup(e); }
}
export async function updateService(adminId: bigint, idText: string, b: Record<string, unknown>) {
  const publicId = requirePublicId(idText, "Invalid service");
  const data = serviceData(b, true);
  if (Object.keys(data).length === 0) throw new AppError(400, "Nothing to change");
  try {
    const s = await prisma.platformQuoteService.update({ where: { publicId }, data: data as never });
    await prisma.platformAuditLog.create({ data: { adminId, action: "quote.service.edit", reason: `Price list: ${s.name}`, details: { name: s.name } } });
    return serviceOut(s);
  } catch (e) {
    if ((e as { code?: string }).code === "P2025") throw new AppError(404, "Service not found");
    return dup(e);
  }
}
export async function deleteService(adminId: bigint, idText: string) {
  const publicId = requirePublicId(idText, "Invalid service");
  const gone = await prisma.platformQuoteService.deleteMany({ where: { publicId } }); // quote lines hold their own copy, so this never changes a quotation
  if (gone.count !== 1) throw new AppError(404, "Service not found");
  await prisma.platformAuditLog.create({ data: { adminId, action: "quote.service.delete", reason: "Price list item removed" } });
}
