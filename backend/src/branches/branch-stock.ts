import { AppError } from "../lib/errors.js";

type Db = { $executeRaw: (q: TemplateStringsArray, ...v: unknown[]) => Promise<number> };

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
