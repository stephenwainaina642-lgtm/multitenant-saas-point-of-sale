import { AppError } from "./errors.js";

/**
 * Public identifiers are random UUIDs. They are the only identifiers the API shows or accepts for tables that
 * have been converted; the sequential database ids stay internal so nobody can count or guess records.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isPublicId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

/** Returns the lower-cased public id, or throws 400 with the given message. */
export function requirePublicId(v: unknown, message: string): string {
  if (!isPublicId(v)) throw new AppError(400, message);
  return v.toLowerCase();
}

type ProductReader = {
  product: {
    findFirst(args: { where: { publicId: string; businessId: bigint }; select: { id: true } }): Promise<{ id: bigint } | null>;
  };
};

/** The internal product id for a public id, within one business. 400 if it is not a UUID, 404 if it isn't this business's. */
export async function productIdFromPublic(client: ProductReader, businessId: bigint, value: unknown): Promise<bigint> {
  const publicId = requirePublicId(value, "A valid product ID is required");
  const row = await client.product.findFirst({ where: { publicId, businessId }, select: { id: true } });
  if (!row) throw new AppError(404, "Product not found");
  return row.id;
}

type SaleReader = {
  sale: {
    findFirst(args: { where: { publicId: string; businessId: bigint }; select: { id: true } }): Promise<{ id: bigint } | null>;
  };
};

/** The internal sale id for a public id, within one business. 400 if it is not a UUID, 404 if it isn't this business's. */
export async function saleIdFromPublic(client: SaleReader, businessId: bigint, value: unknown): Promise<bigint> {
  const publicId = requirePublicId(value, "A valid sale ID is required");
  const row = await client.sale.findFirst({ where: { publicId, businessId }, select: { id: true } });
  if (!row) throw new AppError(404, "Sale not found");
  return row.id;
}

/** The internal purchase id for a public id, within one business (400 if not a UUID, 404 if not this business's). */
export async function purchaseIdFromPublic(
  client: { purchase: { findFirst(args: { where: { publicId: string; businessId: bigint }; select: { id: true } }): Promise<{ id: bigint } | null> } },
  businessId: bigint,
  value: unknown,
): Promise<bigint> {
  const publicId = requirePublicId(value, "A valid purchase ID is required");
  const row = await client.purchase.findFirst({ where: { publicId, businessId }, select: { id: true } });
  if (!row) throw new AppError(404, "Purchase not found");
  return row.id;
}

/** The internal branch id for a public id, within one business (400 if not a UUID, 404 if not this business's). */
export async function branchIdFromPublic(
  client: { branch: { findFirst(args: { where: { publicId: string; businessId: bigint }; select: { id: true } }): Promise<{ id: bigint } | null> } },
  businessId: bigint,
  value: unknown,
  label = "branch",
): Promise<bigint> {
  const publicId = requirePublicId(value, `A valid ${label} ID is required`);
  const row = await client.branch.findFirst({ where: { publicId, businessId }, select: { id: true } });
  if (!row) throw new AppError(404, "Branch not found");
  return row.id;
}
