import prisma from "../lib/prisma.js";
import { AppError } from "../lib/errors.js";

type Input = { name?: unknown; description?: unknown };

function text(value: unknown, field: string, max: number, required: boolean): string | null | undefined {
  if (value === undefined) {
    if (required) throw new AppError(400, `${field} is required`);
    return undefined;
  }
  if (value === null) return null;
  if (typeof value !== "string") throw new AppError(400, `${field} must be text`);
  const t = value.trim();
  if (required && !t) throw new AppError(400, `${field} is required`);
  if (t.length > max) throw new AppError(400, `${field} must be at most ${max} characters`);
  return t || null;
}

const format = (c: { id: bigint; name: string; description: string | null }, productCount: number) => ({
  id: c.id.toString(), name: c.name, description: c.description, productCount,
});

async function ensureNameFree(businessId: bigint, name: string, exceptId?: bigint) {
  const clash = await prisma.category.findFirst({
    where: { businessId, name: { equals: name, mode: "insensitive" }, ...(exceptId && { id: { not: exceptId } }) },
  });
  if (clash) throw new AppError(409, "A category with this name already exists");
}

async function findOwn(businessId: string, idText: string) {
  if (!/^\d+$/.test(idText) || idText === "0") throw new AppError(400, "A valid category ID is required");
  const row = await prisma.category.findFirst({ where: { id: BigInt(idText), businessId: BigInt(businessId) } });
  if (!row) throw new AppError(404, "Category not found");
  return row;
}

export async function listCategories(businessId: string) {
  const rows = await prisma.category.findMany({
    where: { businessId: BigInt(businessId), isActive: true },
    orderBy: { name: "asc" },
    include: { _count: { select: { products: { where: { isActive: true } } } } },
  });
  return rows.map((c) => format(c, c._count.products));
}

export async function createCategory(businessId: string, input: Input, actor?: string) {
  const name = text(input.name, "Category name", 150, true) as string;
  const description = text(input.description, "Description", 500, false) ?? null;
  const bid = BigInt(businessId);
  await ensureNameFree(bid, name);
  const row = await prisma.$transaction(async (tx) => {
    const c = await tx.category.create({ data: { businessId: bid, name, description } });
    await tx.auditLog.create({
      data: { businessId: bid, userId: actor ? BigInt(actor) : null, action: "category.create", entity: "category", entityId: c.id, details: { name } },
    });
    return c;
  });
  return format(row, 0);
}

export async function updateCategory(businessId: string, idText: string, input: Input, actor?: string) {
  const before = await findOwn(businessId, idText);
  const name = text(input.name, "Category name", 150, false);
  if (name === null) throw new AppError(400, "Category name is required");
  const description = text(input.description, "Description", 500, false);
  if (name === undefined && description === undefined) throw new AppError(400, "At least one field is required to update");
  if (name !== undefined) await ensureNameFree(before.businessId, name, before.id);
  const row = await prisma.$transaction(async (tx) => {
    const c = await tx.category.update({
      where: { id: before.id },
      data: { ...(name !== undefined && { name }), ...(description !== undefined && { description }), updatedAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        businessId: before.businessId, userId: actor ? BigInt(actor) : null, action: "category.update", entity: "category", entityId: before.id,
        details: { before: { name: before.name, description: before.description }, after: { name: c.name, description: c.description } },
      },
    });
    return c;
  });
  const count = await prisma.product.count({ where: { categoryId: row.id, isActive: true } });
  return format(row, count);
}

/** A category that still has active products cannot be removed – move them first. */
export async function deleteCategory(businessId: string, idText: string, actor?: string) {
  const row = await findOwn(businessId, idText);
  const inUse = await prisma.product.count({ where: { categoryId: row.id, isActive: true } });
  if (inUse > 0) throw new AppError(409, `${inUse} active product(s) still use this category. Move them to another category first.`);
  await prisma.$transaction(async (tx) => {
    // Archived products keep no category rather than blocking the delete.
    await tx.product.updateMany({ where: { categoryId: row.id }, data: { categoryId: null } });
    await tx.category.delete({ where: { id: row.id } });
    await tx.auditLog.create({
      data: { businessId: row.businessId, userId: actor ? BigInt(actor) : null, action: "category.delete", entity: "category", entityId: row.id, details: { name: row.name } },
    });
  });
  return { id: row.id.toString(), name: row.name };
}

/** Validates a product's category belongs to this business. Returns the id or null. */
export async function resolveCategoryId(businessId: string, value: unknown): Promise<bigint | null> {
  if (value === null || value === "" ) return null;
  if (typeof value !== "string" && typeof value !== "number") throw new AppError(400, "Category is invalid");
  const idText = String(value);
  if (!/^\d+$/.test(idText) || idText === "0") throw new AppError(400, "Category is invalid");
  const row = await prisma.category.findFirst({ where: { id: BigInt(idText), businessId: BigInt(businessId), isActive: true } });
  if (!row) throw new AppError(400, "Category not found in this business");
  return row.id;
}
