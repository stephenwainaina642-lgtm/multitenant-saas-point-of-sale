import prisma from "../lib/prisma.js";
import { AppError } from "../lib/errors.js";
import { Prisma } from "../generated/prisma/client.js";
import { centsToString, decimalToCents, decimalToMilli, milliToString, parseQuantity } from "../lib/money.js";
import { requirePublicId } from "../lib/public-id.js";

/**
 * Recipes: what one portion of a dish uses. An ingredient is an ordinary stock product; the quantity is in that
 * product's own unit (kg, litre, piece...). Cost per portion follows each ingredient's current cost price, so it moves
 * when buying prices change. Selling a dish takes the ingredients out of the selling branch's stock (see sale.service).
 */

export type RecipeLine = { ingredientId: bigint; ingredientName: string; unit: string; quantity: bigint; unitCost: bigint };
type Q = Pick<typeof prisma, "$queryRaw">;

export async function loadRecipes(db: Q, businessId: bigint, dishIds: bigint[]): Promise<Map<bigint, RecipeLine[]>> {
  const out = new Map<bigint, RecipeLine[]>();
  if (dishIds.length === 0) return out;
  const rows = await db.$queryRaw<{ product_id: bigint; ingredient_id: bigint; name: string; unit: string; quantity: string; cost: string }[]>`
    select r.product_id, r.ingredient_id, p.name, p.unit_of_measure as unit, r.quantity::text, p.cost_price::text as cost
      from recipe_items r join products p on p.id = r.ingredient_id
     where r.business_id = ${businessId} and r.product_id in (${Prisma.join(dishIds)})
     order by r.id`;
  for (const r of rows) {
    const list = out.get(r.product_id) ?? [];
    list.push({ ingredientId: r.ingredient_id, ingredientName: r.name, unit: r.unit, quantity: decimalToMilli(r.quantity), unitCost: decimalToCents(r.cost) });
    out.set(r.product_id, list);
  }
  return out;
}

/** a * b / 1000, rounded half up (milli x milli -> milli, or cents x milli -> cents). */
const mulMilli = (a: bigint, b: bigint) => (a * b + 500n) / 1000n;

/** Cost of one portion, in cents. */
export const costPerPortion = (lines: RecipeLine[]) => lines.reduce((s, l) => s + mulMilli(l.unitCost, l.quantity), 0n);

/** A dish with a recipe is costed from its ingredients instead of the cost price typed on the product. */
export function applyRecipeCosts(lines: { productId: bigint; costPrice: bigint }[], recipes: Map<bigint, RecipeLine[]>) {
  for (const l of lines) {
    const r = recipes.get(l.productId);
    if (r && r.length > 0) l.costPrice = costPerPortion(r);
  }
}

/** Ingredient quantities (milli) a set of sale lines uses, summed per ingredient. */
export function ingredientDemand(lines: { productId: bigint; quantity: bigint }[], recipes: Map<bigint, RecipeLine[]>) {
  const out = new Map<bigint, { name: string; quantity: bigint }>();
  for (const l of lines) {
    for (const r of recipes.get(l.productId) ?? []) {
      const q = mulMilli(r.quantity, l.quantity);
      const e = out.get(r.ingredientId);
      if (e) e.quantity += q;
      else out.set(r.ingredientId, { name: r.ingredientName, quantity: q });
    }
  }
  return out;
}

// ---------- management ----------

async function dish(businessId: bigint, idText: string) {
  const publicId = requirePublicId(idText, "Invalid product id");
  const p = await prisma.product.findFirst({ where: { publicId, businessId } });
  if (!p) throw new AppError(404, "Product not found");
  return p;
}

async function show(businessId: bigint, product: { id: bigint; publicId: string; name: string; sellingPrice: Prisma.Decimal; unitOfMeasure: string }) {
  const lines = (await loadRecipes(prisma, businessId, [product.id])).get(product.id) ?? [];
  const cost = costPerPortion(lines);
  const price = decimalToCents(product.sellingPrice);
  const margin = price - cost;
  return {
    productId: product.publicId,
    name: product.name,
    sellingPrice: centsToString(price),
    costPerPortion: centsToString(cost),
    margin: centsToString(margin),
    marginPercent: price > 0n ? Number((margin * 10000n) / price) / 100 : null,
    items: await ingredientsView(lines),
  };
}

async function ingredientsView(lines: RecipeLine[]) {
  const ids = lines.map((l) => l.ingredientId);
  const pubs = ids.length ? await prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true, publicId: true } }) : [];
  const pub = new Map(pubs.map((p) => [p.id, p.publicId]));
  return lines.map((l) => ({
    ingredientId: pub.get(l.ingredientId)!, name: l.ingredientName, unit: l.unit, quantity: milliToString(l.quantity),
    unitCost: centsToString(l.unitCost), lineCost: centsToString(mulMilli(l.unitCost, l.quantity)),
  }));
}

export async function getRecipe(businessId: bigint, idText: string) {
  return show(businessId, await dish(businessId, idText));
}

/** Every dish that has a recipe, with its cost per portion and margin. */
export async function listRecipes(businessId: bigint) {
  const dishes = await prisma.product.findMany({ where: { businessId, isActive: true, recipeAsDish: { some: {} } }, orderBy: { name: "asc" }, take: 500 });
  const recipes = await loadRecipes(prisma, businessId, dishes.map((d) => d.id));
  return dishes.map((d) => {
    const cost = costPerPortion(recipes.get(d.id) ?? []);
    const price = decimalToCents(d.sellingPrice);
    return {
      productId: d.publicId, name: d.name, sellingPrice: centsToString(price), costPerPortion: centsToString(cost),
      margin: centsToString(price - cost), marginPercent: price > 0n ? Number(((price - cost) * 10000n) / price) / 100 : null,
      ingredientCount: recipes.get(d.id)?.length ?? 0,
    };
  });
}

/** Replace a dish's whole recipe (an empty list removes it). */
export async function setRecipe(businessId: bigint, userId: bigint, idText: string, body: { items?: unknown }) {
  const d = await dish(businessId, idText);
  const raw = body.items;
  if (!Array.isArray(raw) || raw.length > 40) throw new AppError(400, "Recipe items must be a list of at most 40 ingredients");
  const wanted = raw.map((x, i) => {
    const it = (x ?? {}) as { ingredientId?: unknown; quantity?: unknown };
    const quantity = parseQuantity(it.quantity, `Ingredient ${i + 1} quantity`);
    if (quantity <= 0n) throw new AppError(400, `Ingredient ${i + 1} quantity must be greater than zero`);
    return { publicId: requirePublicId(String(it.ingredientId ?? ""), `Ingredient ${i + 1} is invalid`), quantity };
  });
  if (new Set(wanted.map((w) => w.publicId)).size !== wanted.length) throw new AppError(400, "An ingredient is listed twice");

  await prisma.$transaction(async (tx) => {
    const ings = wanted.length ? await tx.product.findMany({ where: { businessId, publicId: { in: wanted.map((w) => w.publicId) } } }) : [];
    if (ings.length !== wanted.length) throw new AppError(404, "An ingredient was not found");
    for (const i of ings) {
      if (i.id === d.id) throw new AppError(400, "A dish cannot be its own ingredient");
      if (!i.isActive) throw new AppError(400, `${i.name} is archived and cannot be used as an ingredient`);
      if (!i.tracksStock) throw new AppError(400, `${i.name} is a made-to-order item. Ingredients must be stock items so their stock can be counted.`);
    }
    // One level only: an ingredient cannot itself be a dish with a recipe, and a dish used as an ingredient cannot get one.
    const nested = await tx.recipeItem.findFirst({ where: { businessId, productId: { in: ings.map((i) => i.id) } }, include: { product: true } });
    if (nested) throw new AppError(400, `${nested.product.name} has its own recipe, so it cannot be an ingredient of another dish.`);
    if (wanted.length && (await tx.recipeItem.findFirst({ where: { businessId, ingredientId: d.id } }))) {
      throw new AppError(400, `${d.name} is used as an ingredient in another recipe, so it cannot have a recipe of its own.`);
    }
    await tx.recipeItem.deleteMany({ where: { productId: d.id, businessId } });
    const byPublic = new Map(ings.map((i) => [i.publicId, i.id]));
    if (wanted.length) {
      await tx.recipeItem.createMany({ data: wanted.map((w) => ({ businessId, productId: d.id, ingredientId: byPublic.get(w.publicId)!, quantity: milliToString(w.quantity) })) });
    }
    await tx.auditLog.create({ data: { businessId, userId, action: "recipe.set", entity: "product", entityId: d.id, details: { ingredients: wanted.length } } });
  });
  return show(businessId, d);
}
