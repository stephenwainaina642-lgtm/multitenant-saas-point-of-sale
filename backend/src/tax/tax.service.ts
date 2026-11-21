import crypto from "node:crypto";
import prisma from "../lib/prisma.js";
import { AppError } from "../lib/errors.js";

export const BUILT_IN_CLASSES = ["standard", "zero_rated", "exempt"] as const;
const MAX_CUSTOM_RATES = 20;

type Row = { code: string; name: string; rate: string; builtIn: boolean; productCount: number };

function parseRate(value: unknown): string {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new AppError(400, "Rate must be a number from 0 to 100");
  if (Math.round(n * 100) !== n * 100 && Math.abs(Math.round(n * 100) - n * 100) > 1e-9) throw new AppError(400, "Rate can have at most 2 decimal places");
  return n.toFixed(2);
}

function parseName(value: unknown): string {
  const name = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (!name || name.length > 60) throw new AppError(400, "Rate name is required (max 60 characters)");
  if (/^(standard|zero[ _-]?rated|exempt)$/i.test(name)) throw new AppError(400, "That name is already used by a built-in class");
  return name;
}

/** Every class a product can use: the three built-in ones, then the business's own rates. */
export async function listTaxRates(businessId: string): Promise<Row[]> {
  const bid = BigInt(businessId);
  const [biz, custom, counts] = await Promise.all([
    prisma.business.findUnique({ where: { id: bid }, select: { vatRate: true } }),
    prisma.taxRate.findMany({ where: { businessId: bid }, orderBy: { id: "asc" } }),
    prisma.product.groupBy({ by: ["taxClass"], where: { businessId: bid, isActive: true }, _count: { _all: true } }),
  ]);
  const used = new Map(counts.map((c) => [c.taxClass, c._count._all]));
  return [
    { code: "standard", name: "Standard rate", rate: (biz?.vatRate ?? 16).toString(), builtIn: true, productCount: used.get("standard") ?? 0 },
    { code: "zero_rated", name: "Zero rated", rate: "0.00", builtIn: true, productCount: used.get("zero_rated") ?? 0 },
    { code: "exempt", name: "Exempt", rate: "0.00", builtIn: true, productCount: used.get("exempt") ?? 0 },
    ...custom.map((r) => ({ code: r.code, name: r.name, rate: r.rate.toFixed(2), builtIn: false, productCount: used.get(r.code) ?? 0 })),
  ];
}

export async function createTaxRate(businessId: string, data: { name?: unknown; rate?: unknown }) {
  const bid = BigInt(businessId);
  const name = parseName(data.name);
  const rate = parseRate(data.rate);
  if ((await prisma.taxRate.count({ where: { businessId: bid } })) >= MAX_CUSTOM_RATES) {
    throw new AppError(409, `A business can have at most ${MAX_CUSTOM_RATES} custom rates`);
  }
  if (await prisma.taxRate.findFirst({ where: { businessId: bid, name: { equals: name, mode: "insensitive" } } })) {
    throw new AppError(409, "A rate with this name already exists");
  }
  const code = `rate_${crypto.randomBytes(6).toString("hex")}`; // 5 + 12 = 17 chars
  const row = await prisma.taxRate.create({ data: { businessId: bid, code, name, rate } });
  return { code: row.code, name: row.name, rate: row.rate.toFixed(2), builtIn: false, productCount: 0 };
}

async function findCustom(businessId: bigint, code: string) {
  const row = await prisma.taxRate.findFirst({ where: { businessId, code } });
  if (!row) throw new AppError(404, "Tax rate not found");
  return row;
}

/** Changing a rate only affects sales made from now on; recorded sales keep the rate they were charged. */
export async function updateTaxRate(businessId: string, code: string, data: { name?: unknown; rate?: unknown }) {
  const bid = BigInt(businessId);
  const row = await findCustom(bid, code);
  const name = data.name !== undefined ? parseName(data.name) : row.name;
  const rate = data.rate !== undefined ? parseRate(data.rate) : row.rate.toFixed(2);
  if (name.toLowerCase() !== row.name.toLowerCase()
    && (await prisma.taxRate.findFirst({ where: { businessId: bid, id: { not: row.id }, name: { equals: name, mode: "insensitive" } } }))) {
    throw new AppError(409, "A rate with this name already exists");
  }
  const updated = await prisma.taxRate.update({ where: { id: row.id }, data: { name, rate } });
  return { code: updated.code, name: updated.name, rate: updated.rate.toFixed(2), builtIn: false };
}

export async function deleteTaxRate(businessId: string, code: string) {
  const bid = BigInt(businessId);
  const row = await findCustom(bid, code);
  const inUse = await prisma.product.count({ where: { businessId: bid, taxClass: code } });
  if (inUse > 0) throw new AppError(409, `${inUse} product${inUse === 1 ? " uses" : "s use"} this rate. Move them to another class first`);
  await prisma.taxRate.delete({ where: { id: row.id } });
}

/** Throws unless `code` is a built-in class or one of this business's own rates. */
export async function assertKnownTaxClass(businessId: bigint, code: unknown): Promise<string> {
  if (typeof code !== "string" || !code) throw new AppError(400, "Choose a tax class");
  if ((BUILT_IN_CLASSES as readonly string[]).includes(code)) return code;
  if (await prisma.taxRate.findFirst({ where: { businessId, code }, select: { id: true } })) return code;
  throw new AppError(400, "Unknown tax class for this business");
}

export async function knownTaxClasses(businessId: bigint): Promise<Set<string>> {
  const rows = await prisma.taxRate.findMany({ where: { businessId }, select: { code: true } });
  return new Set([...BUILT_IN_CLASSES, ...rows.map((r) => r.code)]);
}
