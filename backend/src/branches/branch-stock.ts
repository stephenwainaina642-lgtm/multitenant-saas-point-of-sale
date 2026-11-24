import { AppError } from "../lib/errors.js";

type Db = {
  $executeRaw: (q: TemplateStringsArray, ...v: unknown[]) => Promise<number>;
  $queryRaw?: <T = unknown>(q: TemplateStringsArray, ...v: unknown[]) => Promise<T>;
};

/**
 * All stock changes go through branch_stock. A database trigger adds each change to
 * products.stock_quantity (the business-wide total), and another refuses any direct edit of that
 * total, so the two can never disagree.
 */

/** Take stock out of a branch. Returns false when the branch does not hold enough (or the product is inactive). */
export async function takeBranchStock(
  tx: Db, businessId: bigint, branchId: bigint, productId: bigint, quantity: string,
  options: { requireActive?: boolean } = {}
): Promise<boolean> {
  const requireActive = options.requireActive ?? true;
  const n = await tx.$executeRaw`
    UPDATE branch_stock bs
       SET quantity = bs.quantity - ${quantity}::numeric, updated_at = now()
      FROM products p
     WHERE bs.branch_id = ${branchId} AND bs.product_id = ${productId} AND bs.business_id = ${businessId}
       AND p.id = bs.product_id AND (p.is_active = true OR ${!requireActive})
       AND bs.quantity >= ${quantity}::numeric`;
  return n > 0;
}

/** Put stock into a branch (creates the row the first time that branch holds the product). */
export async function addBranchStock(
  tx: Db, businessId: bigint, branchId: bigint, productId: bigint, quantity: string
): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO branch_stock (branch_id, product_id, business_id, quantity)
    VALUES (${branchId}, ${productId}, ${businessId}, ${quantity}::numeric)
    ON CONFLICT (branch_id, product_id)
    DO UPDATE SET quantity = branch_stock.quantity + EXCLUDED.quantity, updated_at = now()`;
}

/** Same as takeBranchStock but throws the standard message. */
export async function takeBranchStockOrFail(
  tx: Db, businessId: bigint, branchId: bigint, productId: bigint, quantity: string, label: string,
  options: { requireActive?: boolean } = {}
): Promise<void> {
  if (!(await takeBranchStock(tx, businessId, branchId, productId, quantity, options))) {
    throw new AppError(400, `Insufficient stock for product: ${label}`);
  }
}

/**
 * For a sale that was rung up offline and has already happened: take what the branch holds, never more, and report the
 * rest as a shortfall. Stock never goes below zero (the database forbids it); the shortfall is for a manager to review.
 * Returns null when the product is inactive or missing (that is still an error).
 */
export async function takeBranchStockClamped(
  tx: Db, businessId: bigint, branchId: bigint, productId: bigint, quantity: string
): Promise<{ taken: string; short: string } | null> {
  const prod = await tx.$queryRaw!<{ active: boolean }[]>`
    SELECT is_active AS active FROM products WHERE id = ${productId} AND business_id = ${businessId}`;
  if (!prod[0] || !prod[0].active) return null;
  // Lock the shelf row so a sale at the same moment cannot take the same units.
  const rows = await tx.$queryRaw!<{ held: string }[]>`
    SELECT quantity::text AS held FROM branch_stock
     WHERE branch_id = ${branchId} AND product_id = ${productId} AND business_id = ${businessId} FOR UPDATE`;
  const row = { held: rows[0]?.held ?? "0" };
  const held = Number(row.held ?? "0");
  const want = Number(quantity);
  const taken = Math.max(0, Math.min(held, want));
  if (taken > 0) {
    const n = await tx.$executeRaw`
      UPDATE branch_stock SET quantity = quantity - ${taken.toFixed(3)}::numeric, updated_at = now()
       WHERE branch_id = ${branchId} AND product_id = ${productId} AND business_id = ${businessId} AND quantity >= ${taken.toFixed(3)}::numeric`;
    if (n === 0) return null;
  }
  return { taken: taken.toFixed(3), short: Math.max(0, want - taken).toFixed(3) };
}

/** Made-to-order items (meals) do not track stock: selling, editing or voiding them must not touch it. */
export async function untrackedProductIds(
  tx: { product: { findMany: (args: { where: { businessId: bigint; id: { in: bigint[] }; tracksStock: false }; select: { id: true } }) => Promise<{ id: bigint }[]> } },
  businessId: bigint,
  productIds: bigint[]
): Promise<Set<bigint>> {
  if (productIds.length === 0) return new Set();
  const rows = await tx.product.findMany({ where: { businessId, id: { in: productIds }, tracksStock: false }, select: { id: true } });
  return new Set(rows.map((r) => r.id));
}
