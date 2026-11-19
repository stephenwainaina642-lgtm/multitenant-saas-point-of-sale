import prisma from "../lib/prisma.js";
import { AppError } from "../lib/errors.js";
import { addBranchStock, takeBranchStockOrFail } from "./branch-stock.js";
import { milliToString, parseQuantity } from "../lib/money.js";

type Actor = { userId: string; canSeeAll: boolean; branchId: bigint };

const format = (b: { id: bigint; name: string; address: string | null; phone: string | null; isMain: boolean; isActive: boolean }) => ({
  id: b.id.toString(), name: b.name, address: b.address, phone: b.phone, isMain: b.isMain, isActive: b.isActive,
});

function cleanText(value: unknown, label: string, max: number, required = false): string | null {
  if (value === undefined || value === null || value === "") {
    if (required) throw new AppError(400, `${label} is required`);
    return null;
  }
  if (typeof value !== "string") throw new AppError(400, `${label} must be text`);
  const v = value.trim();
  if (required && !v) throw new AppError(400, `${label} is required`);
  if (v.length > max) throw new AppError(400, `${label} must not exceed ${max} characters`);
  return v || null;
}

function idOf(text: unknown, label = "id"): bigint {
  if (typeof text !== "string" && typeof text !== "number") throw new AppError(400, `Invalid ${label}`);
  const t = String(text);
  if (!/^[1-9]\d{0,17}$/.test(t)) throw new AppError(400, `Invalid ${label}`);
  return BigInt(t);
}

/** Branches the caller may see: everything for "branches.all", otherwise only their own. */
export async function listBranches(businessId: bigint, actor: Actor) {
  const rows = await prisma.branch.findMany({
    where: { businessId, ...(actor.canSeeAll ? {} : { id: actor.branchId }) },
    orderBy: [{ isMain: "desc" }, { name: "asc" }],
  });
  return rows.map((b) => ({ ...format(b), current: b.id === actor.branchId }));
}

export async function createBranch(businessId: bigint, userId: string, body: Record<string, unknown>) {
  const name = cleanText(body.name, "Branch name", 120, true)!;
  try {
    const b = await prisma.$transaction(async (tx) => {
      const created = await tx.branch.create({
        data: { businessId, name, address: cleanText(body.address, "Address", 500), phone: cleanText(body.phone, "Phone", 50) },
      });
      await tx.auditLog.create({ data: { businessId, userId: BigInt(userId), action: "branch.create", entity: "branch", entityId: created.id, details: { name } } });
      return created;
    });
    return format(b);
  } catch (e) {
    if ((e as { code?: string })?.code === "P2002") throw new AppError(409, "A branch with that name already exists");
    throw e;
  }
}

export async function updateBranch(businessId: bigint, userId: string, idText: unknown, body: Record<string, unknown>) {
  const id = idOf(idText, "branch id");
  return prisma.$transaction(async (tx) => {
    const branch = await tx.branch.findFirst({ where: { id, businessId } });
    if (!branch) throw new AppError(404, "Branch not found");
    const data: { name?: string; address?: string | null; phone?: string | null; isActive?: boolean } = {};
    if (body.name !== undefined) data.name = cleanText(body.name, "Branch name", 120, true)!;
    if (body.address !== undefined) data.address = cleanText(body.address, "Address", 500);
    if (body.phone !== undefined) data.phone = cleanText(body.phone, "Phone", 50);
    if (body.isActive !== undefined) {
      if (typeof body.isActive !== "boolean") throw new AppError(400, "isActive must be true or false");
      if (!body.isActive && branch.isActive) {
        if (branch.isMain) throw new AppError(409, "The main branch cannot be deactivated");
        const [held] = await tx.$queryRaw<{ n: bigint }[]>`
          select count(*) as n from branch_stock where branch_id = ${id} and quantity > 0`;
        if (held && held.n > 0n) throw new AppError(409, "This branch still holds stock. Transfer it to another branch first.");
        const open = await tx.registerShift.count({ where: { branchId: id, status: "open" } });
        if (open > 0) throw new AppError(409, "This branch has an open till shift. Close it first.");
      }
      data.isActive = body.isActive;
    }
    try {
      const updated = await tx.branch.update({ where: { id }, data: { ...data, updatedAt: new Date() } });
      await tx.auditLog.create({ data: { businessId, userId: BigInt(userId), action: "branch.update", entity: "branch", entityId: id, details: JSON.parse(JSON.stringify(data)) } });
      return format(updated);
    } catch (e) {
      if ((e as { code?: string })?.code === "P2002") throw new AppError(409, "A branch with that name already exists");
      throw e;
    }
  });
}

/** Assign a staff member to a branch (null = not tied to one). */
export async function assignStaff(businessId: bigint, actorId: string, userIdText: unknown, branchIdValue: unknown) {
  const userId = idOf(userIdText, "user id");
  const branchId = branchIdValue === null || branchIdValue === undefined || branchIdValue === "" ? null : idOf(branchIdValue, "branch id");
  const member = await prisma.businessUser.findFirst({ where: { businessId, userId, isActive: true } });
  if (!member) throw new AppError(404, "Staff member not found");
  if (branchId) {
    const b = await prisma.branch.findFirst({ where: { id: branchId, businessId, isActive: true } });
    if (!b) throw new AppError(404, "Branch not found");
  }
  await prisma.$transaction([
    prisma.businessUser.update({ where: { id: member.id }, data: { branchId, updatedAt: new Date() } }),
    prisma.auditLog.create({ data: { businessId, userId: BigInt(actorId), action: "branch.assign_staff", entity: "user", entityId: userId, details: { branchId: branchId?.toString() ?? null } } }),
  ]);
  return { userId: userId.toString(), branchId: branchId?.toString() ?? null };
}

/** Quantity per branch for every product that is held somewhere the caller may see. */
export async function stockByBranch(businessId: bigint, actor: Actor) {
  const rows = await prisma.branchStock.findMany({
    where: { businessId, ...(actor.canSeeAll ? {} : { branchId: actor.branchId }) },
    select: { branchId: true, productId: true, quantity: true },
  });
  return rows.map((r) => ({ branchId: r.branchId.toString(), productId: r.productId.toString(), quantity: r.quantity }));
}

type TransferBody = { fromBranchId?: unknown; toBranchId?: unknown; items?: unknown; notes?: unknown; reference?: unknown };

export async function createTransfer(businessId: bigint, actor: Actor, body: TransferBody, idempotencyKey?: string) {
  const from = idOf(body.fromBranchId, "source branch");
  const to = idOf(body.toBranchId, "destination branch");
  if (from === to) throw new AppError(400, "Choose two different branches");
  if (!actor.canSeeAll && from !== actor.branchId) {
    throw new AppError(403, "You can only send stock out of your own branch");
  }
  if (!Array.isArray(body.items) || body.items.length === 0) throw new AppError(400, "Add at least one product to transfer");
  if (body.items.length > 200) throw new AppError(400, "Too many lines in one transfer (maximum 200)");
  const key = idempotencyKey?.trim() ? idempotencyKey.trim().slice(0, 100) : undefined;

  const merged = new Map<bigint, bigint>();
  for (const raw of body.items as Record<string, unknown>[]) {
    const productId = idOf(raw?.productId, "product id");
    let milli: bigint;
    try {
      milli = parseQuantity(raw?.quantity, "Quantity");
    } catch (e) {
      throw new AppError(400, e instanceof Error ? e.message : "Invalid quantity");
    }
    if (milli <= 0n) throw new AppError(400, "Quantity must be greater than zero");
    merged.set(productId, (merged.get(productId) ?? 0n) + milli);
  }
  const lines = [...merged.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const notes = cleanText(body.notes, "Notes", 1000);
  const reference = cleanText(body.reference, "Reference", 100);

  const run = () => prisma.$transaction(async (tx) => {
    if (key) {
      const earlier = await tx.stockTransfer.findFirst({ where: { businessId, idempotencyKey: key }, include: { items: true } });
      if (earlier) return { transfer: earlier, replay: true };
    }
    const branches = await tx.branch.findMany({ where: { id: { in: [from, to] }, businessId } });
    const src = branches.find((b) => b.id === from);
    const dst = branches.find((b) => b.id === to);
    if (!src || !dst) throw new AppError(404, "Branch not found");
    if (!src.isActive || !dst.isActive) throw new AppError(409, "Both branches must be active");

    const products = await tx.product.findMany({ where: { id: { in: lines.map(([id]) => id) }, businessId, isActive: true } });
    if (products.length !== lines.length) throw new AppError(404, "One of the products was not found");
    const names = new Map(products.map((p) => [p.id, p.name]));

    const transfer = await tx.stockTransfer.create({
      data: { businessId, fromBranchId: from, toBranchId: to, reference, notes, idempotencyKey: key ?? null, createdBy: BigInt(actor.userId) },
    });
    const ref = `TRANSFER-${transfer.id.toString()}`;

    for (const [productId, milli] of lines) {
      const qty = milliToString(milli);
      // Make sure both rows exist, then lock them in a fixed order so opposite transfers cannot deadlock.
      await addBranchStock(tx, businessId, to, productId, "0");
      await addBranchStock(tx, businessId, from, productId, "0");
      await tx.$queryRaw`select 1 from branch_stock where product_id = ${productId} and branch_id in (${from}, ${to}) order by branch_id for update`;
      await takeBranchStockOrFail(tx, businessId, from, productId, qty, names.get(productId) ?? "");
      await addBranchStock(tx, businessId, to, productId, qty);
      await tx.stockTransferItem.create({ data: { transferId: transfer.id, productId, quantity: qty } });
      await tx.inventoryMovement.createMany({
        data: [
          { businessId, branchId: from, productId, type: "OUT", quantity: qty, reference: ref, notes: `Transferred to ${dst.name}` },
          { businessId, branchId: to, productId, type: "IN", quantity: qty, reference: ref, notes: `Transferred from ${src.name}` },
        ],
      });
    }
    await tx.auditLog.create({
      data: { businessId, userId: BigInt(actor.userId), action: "stock.transfer", entity: "stock_transfer", entityId: transfer.id, details: { from: src.name, to: dst.name, lines: lines.length } },
    });
    const full = await tx.stockTransfer.findUniqueOrThrow({ where: { id: transfer.id }, include: { items: true } });
    return { transfer: full, replay: false };
  }, { timeout: 30_000 });

  try {
    const { transfer, replay } = await run();
    return { ...(await formatTransfer(transfer)), idempotentReplay: replay };
  } catch (e) {
    if (key && (e as { code?: string })?.code === "P2002") {
      const winner = await prisma.stockTransfer.findFirst({ where: { businessId, idempotencyKey: key }, include: { items: true } });
      if (winner) return { ...(await formatTransfer(winner)), idempotentReplay: true };
    }
    throw e;
  }
}

type TransferRow = {
  id: bigint; fromBranchId: bigint; toBranchId: bigint; reference: string | null; notes: string | null; createdAt: Date;
  items: { productId: bigint; quantity: unknown }[];
};

async function formatTransfer(t: TransferRow) {
  const [branches, products] = await Promise.all([
    prisma.branch.findMany({ where: { id: { in: [t.fromBranchId, t.toBranchId] } }, select: { id: true, name: true } }),
    prisma.product.findMany({ where: { id: { in: t.items.map((i) => i.productId) } }, select: { id: true, name: true, sku: true } }),
  ]);
  const bn = new Map(branches.map((b) => [b.id, b.name]));
  const pn = new Map(products.map((p) => [p.id, p]));
  return {
    id: t.id.toString(),
    fromBranchId: t.fromBranchId.toString(), fromBranchName: bn.get(t.fromBranchId) ?? "",
    toBranchId: t.toBranchId.toString(), toBranchName: bn.get(t.toBranchId) ?? "",
    reference: t.reference, notes: t.notes, createdAt: t.createdAt,
    items: t.items.map((i) => ({ productId: i.productId.toString(), productName: pn.get(i.productId)?.name ?? "", sku: pn.get(i.productId)?.sku ?? null, quantity: String(i.quantity) })),
  };
}

export async function listTransfers(businessId: bigint, actor: Actor) {
  const rows = await prisma.stockTransfer.findMany({
    where: {
      businessId,
      ...(actor.canSeeAll ? {} : { OR: [{ fromBranchId: actor.branchId }, { toBranchId: actor.branchId }] }),
    },
    include: { items: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return Promise.all(rows.map(formatTransfer));
}
