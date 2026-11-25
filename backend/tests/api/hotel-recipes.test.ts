import { describe, it, expect, beforeAll } from "vitest";
import { query, resetData } from "../support/db.js";
import { del, get, post, put } from "../support/http.js";
import { addEmployee, createCustomer, createProduct, ledgerViolations, registerTenant, type Tenant } from "../support/seed.js";

describe("hotel: recipes, ingredient costing and stock", () => {
  let owner: Tenant, other: Tenant;
  let n = 0;
  const stockOf = async (id: string) =>
    Number((await query<{ q: string }>(`select coalesce(sum(bs.quantity),0)::text q from branch_stock bs join products p on p.id = bs.product_id where p.public_id = $1::uuid`, [id]))[0]!.q);
  const ingredient = async (name: string, stock: number, cost: number, t: Tenant = owner) =>
    (await createProduct(t, { name: `${name} ${++n}`, costPrice: cost, sellingPrice: cost * 2, stockQuantity: stock })).id as string;
  const dish = async (name: string, price: number, t: Tenant = owner) =>
    (await post("/products", t, { name: `${name} ${++n}`, costPrice: 0, sellingPrice: price, tracksStock: false })).body.data.id as string;
  const recipe = (d: string, items: [string, number][], t: Tenant = owner) =>
    put(`/hotel/recipes/${d}`, t, { items: items.map(([ingredientId, quantity]) => ({ ingredientId, quantity })) });
  const sell = (t: Tenant, productId: string, quantity: number, price: number) =>
    post("/sales", t, { amountPaid: quantity * price, paymentMethod: "cash", items: [{ productId, quantity, unitPrice: price }] });

  beforeAll(async () => {
    await resetData();
    owner = await registerTenant("Recipe Hotel", "hotel");
    other = await registerTenant("Other Recipe Hotel", "hotel");
  }, 60_000);

  it("shows cost per portion and margin from the ingredients' buying prices", async () => {
    const rice = await ingredient("Rice", 50, 200); // KSh 200 per kg
    const chicken = await ingredient("Chicken", 30, 600);
    const d = await dish("Pilau", 500);
    const r = await recipe(d, [[rice, 0.15], [chicken, 0.25]]);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.costPerPortion).toBe("180.00"); // 30 + 150
    expect(r.body.data.margin).toBe("320.00");
    expect(r.body.data.marginPercent).toBe(64);
    expect(r.body.data.items.map((i: any) => i.lineCost)).toEqual(["30.00", "150.00"]);
    const list = (await get("/hotel/recipes", owner)).body.data as any[];
    expect(list.find((x) => x.productId === d).costPerPortion).toBe("180.00");
  });

  it("cost follows the ingredient's current buying price", async () => {
    const oil = await ingredient("Oil", 20, 300);
    const d = await dish("Fried fish", 400);
    await recipe(d, [[oil, 0.1]]);
    expect((await get(`/hotel/recipes/${d}`, owner)).body.data.costPerPortion).toBe("30.00");
    expect((await put(`/products/${oil}`, owner, { costPrice: 400 })).status).toBe(200);
    expect((await get(`/hotel/recipes/${d}`, owner)).body.data.costPerPortion).toBe("40.00");
  });

  it("selling a dish takes the ingredients out of stock, records the cost on the sale and the usage", async () => {
    const rice = await ingredient("Rice", 10, 200), beans = await ingredient("Beans", 10, 100);
    const d = await dish("Rice and beans", 300);
    await recipe(d, [[rice, 0.2], [beans, 0.1]]);
    const s = await sell(owner, d, 3, 300);
    expect(s.status, JSON.stringify(s.body)).toBe(201);
    expect(await stockOf(rice)).toBeCloseTo(9.4, 3);
    expect(await stockOf(beans)).toBeCloseTo(9.7, 3);
    const items = await query<{ cost_price: string }>(`select i.cost_price::text from sale_items i join sales s on s.id = i.sale_id where s.public_id = $1::uuid`, [s.body.data.id]);
    expect(items[0]!.cost_price).toBe("50.00"); // 40 + 10
    const use = await query<{ q: string }>(`select u.quantity::text q from sale_ingredient_usage u join sales s on s.id = u.sale_id where s.public_id = $1::uuid order by u.product_id`, [s.body.data.id]);
    expect(use.map((u) => Number(u.q))).toEqual([0.6, 0.3]);
    expect(await ledgerViolations()).toEqual([]);
  });

  it("voiding the sale gives back exactly what was taken, even after the recipe changed", async () => {
    const rice = await ingredient("Rice", 10, 200);
    const d = await dish("Plain rice", 100);
    await recipe(d, [[rice, 0.5]]);
    const s = await sell(owner, d, 2, 100);
    expect(await stockOf(rice)).toBeCloseTo(9, 3);
    await recipe(d, [[rice, 0.9]]); // recipe changed after the sale
    const v = await post(`/sales/${s.body.data.id}/void`, owner, { reason: "Wrong order", refundMethod: "cash" });
    expect(v.status, JSON.stringify(v.body)).toBe(200);
    expect(await stockOf(rice)).toBeCloseTo(10, 3);
    expect(await ledgerViolations()).toEqual([]);
  });

  it("editing the quantity of a dish moves ingredient stock by the difference only", async () => {
    const rice = await ingredient("Rice", 10, 200);
    const d = await dish("Rice bowl", 100);
    await recipe(d, [[rice, 0.5]]);
    const cust = (await createCustomer(owner, "Edit Guest")).id;
    const s = await post("/sales", owner, { customerId: cust, amountPaid: 0, items: [{ productId: d, quantity: 2, unitPrice: 100 }] });
    expect(await stockOf(rice)).toBeCloseTo(9, 3);
    const e1 = await put(`/sales/${s.body.data.id}`, owner, { customerId: cust, items: [{ productId: d, quantity: 4, unitPrice: 100 }] });
    expect(e1.status, JSON.stringify(e1.body)).toBe(200);
    expect(await stockOf(rice)).toBeCloseTo(8, 3);
    const e2 = await put(`/sales/${s.body.data.id}`, owner, { customerId: cust, items: [{ productId: d, quantity: 1, unitPrice: 100 }] });
    expect(e2.status).toBe(200);
    expect(await stockOf(rice)).toBeCloseTo(9.5, 3);
    const v = await post(`/sales/${s.body.data.id}/void`, owner, { reason: "x", refundMethod: "cash" });
    expect(v.status).toBe(200);
    expect(await stockOf(rice)).toBeCloseTo(10, 3);
  });

  it("when an ingredient runs short the sale still goes through, stock stops at zero and a shortfall is flagged", async () => {
    const rice = await ingredient("Rice", 0.3, 200);
    const d = await dish("Big rice", 100);
    await recipe(d, [[rice, 0.2]]);
    const s = await sell(owner, d, 3, 100); // needs 0.6, holds 0.3
    expect(s.status, JSON.stringify(s.body)).toBe(201);
    expect(await stockOf(rice)).toBe(0);
    const f = (await get("/inventory/offline-shortfalls", owner)).body.data as any[];
    const row = JSON.stringify(f);
    expect(row).toContain('"quantityShort":"0.3"');
    expect(row).toContain('Rice');
    const v = await post(`/sales/${s.body.data.id}/void`, owner, { reason: "x", refundMethod: "cash" });
    expect(v.status).toBe(200);
    expect(await stockOf(rice)).toBeCloseTo(0.3, 3); // only what was actually taken goes back
  });

  it("a product sold directly and also used as an ingredient in the same sale is handled together", async () => {
    const oil = await ingredient("Oil", 10, 300);
    const d = await dish("Chips", 150);
    await recipe(d, [[oil, 0.1]]);
    const r = await post("/sales", owner, { amountPaid: 150 + 600, paymentMethod: "cash", items: [{ productId: d, quantity: 1, unitPrice: 150 }, { productId: oil, quantity: 1, unitPrice: 600 }] });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(await stockOf(oil)).toBeCloseTo(8.9, 3);
  });

  it("table orders billed through the hotel flow use the recipe too", async () => {
    const rice = await ingredient("Rice", 10, 200);
    const d = await dish("Table rice", 250);
    await recipe(d, [[rice, 0.25]]);
    const tb = (await post("/hotel/tables", owner, { name: `RT${++n}` })).body.data.id;
    const o = (await post(`/hotel/tables/${tb}/orders`, owner, {})).body.data.id;
    await post(`/hotel/orders/${o}/items`, owner, { productId: d, quantity: 2 });
    const b = await post(`/hotel/orders/${o}/bill`, owner, { paymentMethod: "cash" });
    expect(b.status, JSON.stringify(b.body)).toBe(200);
    expect(await stockOf(rice)).toBeCloseTo(9.5, 3);
  });

  it("a dish without a recipe still behaves exactly as before", async () => {
    const d = await dish("Tea", 50);
    const s = await sell(owner, d, 2, 50);
    expect(s.status).toBe(201);
    const use = await query(`select 1 from sale_ingredient_usage u join sales s on s.id = u.sale_id where s.public_id = $1::uuid`, [s.body.data.id]);
    expect(use).toHaveLength(0);
  });

  it("removing the recipe (empty list) stops ingredient use for later sales", async () => {
    const rice = await ingredient("Rice", 10, 200);
    const d = await dish("Rice 2", 100);
    await recipe(d, [[rice, 1]]);
    expect((await recipe(d, [])).status).toBe(200);
    await sell(owner, d, 1, 100);
    expect(await stockOf(rice)).toBe(10);
  });

  it("rejects bad recipes: made-to-order or archived ingredients, itself, duplicates, nested recipes, bad quantities", async () => {
    const rice = await ingredient("Rice", 10, 200);
    const meal = await dish("Meal A", 100), meal2 = await dish("Meal B", 100);
    expect((await recipe(meal, [[meal2, 1]])).status).toBe(400); // made to order
    expect((await recipe(meal, [[meal, 1]])).status).toBe(400); // itself (also made to order)
    expect((await recipe(meal, [[rice, 1], [rice, 2]])).status).toBe(400); // duplicate
    expect((await recipe(meal, [[rice, 0]])).status).toBe(400);
    expect((await recipe(meal, [[rice, -1]])).status).toBe(400);
    expect((await recipe(meal, [[rice, 1.0005]])).status).toBe(400);
    expect((await recipe(meal, [["00000000-0000-4000-8000-000000000000", 1]])).status).toBe(404);
    // nested: a stock product that has its own recipe cannot be an ingredient
    const sauce = await ingredient("Sauce", 5, 100), tomato = await ingredient("Tomato", 5, 50);
    expect((await recipe(sauce, [[tomato, 0.5]])).status).toBe(200);
    expect((await recipe(meal, [[sauce, 1]])).status).toBe(400);
    expect((await recipe(tomato, [[rice, 1]])).status).toBe(400); // tomato is an ingredient already
    const gone = await ingredient("Old stock", 5, 10);
    const arch = await del(`/products/${gone}`, owner);
    expect(arch.status, JSON.stringify(arch.body)).toBe(200);
    expect((await recipe(meal, [[gone, 1]])).status).toBe(400);
  });

  it("another business cannot read or change this business's recipes or use its ingredients", async () => {
    const rice = await ingredient("Rice", 10, 200);
    const d = await dish("Mine", 100);
    await recipe(d, [[rice, 1]]);
    expect((await get(`/hotel/recipes/${d}`, other)).status).toBe(404);
    expect((await recipe(d, [], other)).status).toBe(404);
    const theirs = await dish("Theirs", 100, other);
    expect((await recipe(theirs, [[rice, 1]], other)).status).toBe(404);
  });

  it("viewing recipes needs products.view and changing them needs products.manage", async () => {
    const rice = await ingredient("Rice", 10, 200);
    const d = await dish("Perm dish", 100);
    const viewer = await addEmployee(owner, "recipe viewer", ["products.view"]);
    const nobody = await addEmployee(owner, "recipe nobody", ["sales.create"]);
    expect((await get("/hotel/recipes", viewer)).status).toBe(200);
    expect((await recipe(d, [[rice, 1]], viewer)).status).toBe(403);
    expect((await get("/hotel/recipes", nobody)).status).toBe(403);
  });
});
