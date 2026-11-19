import { describe, it, expect, beforeAll } from "vitest";
import { query, resetData } from "../support/db.js";
import { api, get, post } from "../support/http.js";
import { addEmployee, createProduct, registerTenant } from "../support/seed.js";

const line = (productId: string, quantity: number, unitPrice = 100) => ({ productId, quantity, unitPrice });
const inBranch = (t: { token: string; businessId: string }, branchId: string, method: string, path: string, body?: unknown, extra: Record<string, string> = {}) =>
  api(method, path, { session: t, body, headers: { "x-branch-id": branchId, ...extra } });
const stockRows = (productId: string) =>
  query<{ name: string; quantity: string }>(
    `select b.name, bs.quantity::text from branch_stock bs join branches b on b.id = bs.branch_id where bs.product_id = $1 order by b.is_main desc, b.name`, [productId]);
const total = async (productId: string) => Number((await query<{ s: string }>(`select stock_quantity::text s from products where id = $1`, [productId]))[0]!.s);
async function totalsMatch() {
  const bad = await query(
    `select p.id from products p where p.stock_quantity <> coalesce((select sum(quantity) from branch_stock where product_id = p.id), 0)`);
  return bad.length === 0;
}

describe("branches with their own stock", () => {
  let owner: Awaited<ReturnType<typeof registerTenant>>;
  let main: string, westlands: string;
  let item: { id: string };

  beforeAll(async () => {
    await resetData();
    owner = await registerTenant("Branch Shop");
    item = await createProduct(owner, { name: "Sugar 1kg", costPrice: 80, sellingPrice: 150, stockQuantity: 20 });
    const list = (await get("/branches", owner)).body.data;
    main = list.find((b: any) => b.isMain).id;
    const created = await post("/branches", owner, { name: "Westlands", address: "Waiyaki Way", phone: "0700000000" });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    westlands = created.body.data.id;
  }, 60_000);

  it("gives every business a Main branch holding its opening stock", async () => {
    const list = (await get("/branches", owner)).body.data;
    expect(list.map((b: any) => b.name)).toEqual(["Main", "Westlands"]);
    expect(list[0]).toMatchObject({ isMain: true, isActive: true, current: true });
    expect(await stockRows(item.id)).toEqual([{ name: "Main", quantity: "20.000" }]);
    expect(await total(item.id)).toBe(20);
  });

  it("refuses a duplicate branch name, and a non-manager cannot create branches", async () => {
    expect((await post("/branches", owner, { name: "Westlands" })).status).toBe(409);
    expect((await post("/branches", owner, { name: "   " })).status).toBe(400);
    const clerk = await addEmployee(owner, "till clerk", ["sales.create", "products.view"]);
    expect((await post("/branches", clerk, { name: "Sneaky" })).status).toBe(403);
  });

  it("moves stock between branches in one step and keeps the business total", async () => {
    const r = await post("/branches/transfers", owner, { fromBranchId: main, toBranchId: westlands, items: [{ productId: item.id, quantity: 8 }], notes: "Opening the new shop" });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data.items[0]).toMatchObject({ productName: "Sugar 1kg" });
    expect(Number(r.body.data.items[0].quantity)).toBe(8);
    expect(await stockRows(item.id)).toEqual([{ name: "Main", quantity: "12.000" }, { name: "Westlands", quantity: "8.000" }]);
    expect(await total(item.id)).toBe(20);
    const moves = await query<{ type: string; name: string }>(
      `select m.type, b.name from inventory_movements m join branches b on b.id = m.branch_id where m.reference = $1 order by m.type`, [`TRANSFER-${r.body.data.id}`]);
    expect(moves).toEqual([{ type: "IN", name: "Westlands" }, { type: "OUT", name: "Main" }]);
    expect(await totalsMatch()).toBe(true);
  });

  it("refuses a transfer that the source branch cannot cover, and changes nothing", async () => {
    const before = await stockRows(item.id);
    const r = await post("/branches/transfers", owner, { fromBranchId: westlands, toBranchId: main, items: [{ productId: item.id, quantity: 9 }] });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/Insufficient stock/);
    expect(await stockRows(item.id)).toEqual(before);
    expect((await post("/branches/transfers", owner, { fromBranchId: main, toBranchId: main, items: [{ productId: item.id, quantity: 1 }] })).status).toBe(400);
    expect((await post("/branches/transfers", owner, { fromBranchId: main, toBranchId: westlands, items: [] })).status).toBe(400);
    expect((await post("/branches/transfers", owner, { fromBranchId: main, toBranchId: westlands, items: [{ productId: item.id, quantity: 0 }] })).status).toBe(400);
  });

  it("does not transfer twice when the same request is repeated", async () => {
    const send = () => api("POST", "/branches/transfers", { session: owner, headers: { "idempotency-key": "tr-once-1" }, body: { fromBranchId: main, toBranchId: westlands, items: [{ productId: item.id, quantity: 2 }] } });
    const [a, b] = [await send(), await send()];
    expect(a.status).toBe(201);
    expect(b.body.data.idempotentReplay).toBe(true);
    expect(b.body.data.id).toBe(a.body.data.id);
    expect(await stockRows(item.id)).toEqual([{ name: "Main", quantity: "10.000" }, { name: "Westlands", quantity: "10.000" }]);
  });

  it("sells from the selling branch only, and refuses what that branch does not hold", async () => {
    const sale = await inBranch(owner, westlands, "POST", "/sales", { items: [line(item.id, 4, 150)], paymentMethod: "cash", amountPaid: 600 });
    expect(sale.status, JSON.stringify(sale.body)).toBe(201);
    expect(await stockRows(item.id)).toEqual([{ name: "Main", quantity: "10.000" }, { name: "Westlands", quantity: "6.000" }]);
    // Main still has 10, but Westlands only 6: selling 7 at Westlands must fail.
    const tooMany = await inBranch(owner, westlands, "POST", "/sales", { items: [line(item.id, 7, 150)], paymentMethod: "cash", amountPaid: 1050 });
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.message).toMatch(/Insufficient stock/);
    expect(await total(item.id)).toBe(16);
    // The sale remembers its branch.
    const row = await query<{ name: string }>(`select b.name from sales s join branches b on b.id = s.branch_id where s.id = $1`, [sale.body.data.id]);
    expect(row[0]!.name).toBe("Westlands");
  });

  it("returns stock to the branch the sale was made in, even if voided from another", async () => {
    const sale = await inBranch(owner, westlands, "POST", "/sales", { items: [line(item.id, 2, 150)], paymentMethod: "cash", amountPaid: 300 });
    expect(sale.status).toBe(201);
    const before = await stockRows(item.id);
    const voided = await inBranch(owner, main, "POST", `/sales/${sale.body.data.id}/void`, { reason: "test", refundMethod: "cash" });
    expect(voided.status, JSON.stringify(voided.body)).toBe(200);
    const after = await stockRows(item.id);
    expect(Number(after[0]!.quantity)).toBe(Number(before[0]!.quantity));          // Main unchanged
    expect(Number(after[1]!.quantity)).toBe(Number(before[1]!.quantity) + 2);       // Westlands got it back
    expect(await totalsMatch()).toBe(true);
  });

  it("counts stock per branch when adjusting", async () => {
    const r = await inBranch(owner, westlands, "POST", "/inventory", { productId: item.id, type: "ADJUSTMENT", quantity: 3, notes: "stock count" });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data.product.branchQuantity).toBe(3);
    const rows = await stockRows(item.id);
    expect(rows.find((x) => x.name === "Westlands")!.quantity).toBe("3.000");
    expect(Number(rows.find((x) => x.name === "Main")!.quantity)).toBe(10);
    expect(await totalsMatch()).toBe(true);
  });

  it("keeps staff assigned to a branch inside it, and the database refuses direct edits of the total", async () => {
    const clerk = await addEmployee(owner, "branch clerk", ["sales.create", "products.view", "inventory.view"]);
    const asg = await api("PUT", `/branches/staff/${clerk.userId}`, { session: owner, body: { branchId: westlands } });
    expect(asg.status, JSON.stringify(asg.body)).toBe(200);
    // The clerk asks for Main but is kept in Westlands.
    const list = (await inBranch(clerk, main, "GET", "/branches")).body.data;
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(westlands);
    const sale = await inBranch(clerk, main, "POST", "/sales", { items: [line(item.id, 1, 150)], paymentMethod: "cash", amountPaid: 150 });
    expect(sale.status, JSON.stringify(sale.body)).toBe(201);
    const row = await query<{ name: string }>(`select b.name from sales s join branches b on b.id = s.branch_id where s.id = $1`, [sale.body.data.id]);
    expect(row[0]!.name).toBe("Westlands");
    expect((await inBranch(clerk, main, "POST", "/branches/transfers", { fromBranchId: main, toBranchId: westlands, items: [{ productId: item.id, quantity: 1 }] })).status).toBe(403);
    await expect(query(`update products set stock_quantity = 999 where id = $1`, [item.id])).rejects.toThrow(/total of branch_stock/);
  });

  it("will not let one business use another business's branch", async () => {
    const other = await registerTenant("Other Shop");
    const theirMain = (await get("/branches", other)).body.data[0].id;
    expect((await inBranch(owner, theirMain, "GET", "/branches")).status).toBe(403);
    const t = await post("/branches/transfers", owner, { fromBranchId: main, toBranchId: theirMain, items: [{ productId: item.id, quantity: 1 }] });
    expect(t.status).toBe(404);
  });

  it("will not close a branch that still holds stock, or the main branch", async () => {
    expect((await api("PATCH", `/branches/${westlands}`, { session: owner, body: { isActive: false } })).status).toBe(409);
    expect((await api("PATCH", `/branches/${main}`, { session: owner, body: { isActive: false } })).status).toBe(409);
    const rows = await stockRows(item.id);
    const w = Number(rows.find((x) => x.name === "Westlands")!.quantity);
    const move = await post("/branches/transfers", owner, { fromBranchId: westlands, toBranchId: main, items: [{ productId: item.id, quantity: w }] });
    expect(move.status, JSON.stringify(move.body)).toBe(201);
    expect((await api("PATCH", `/branches/${westlands}`, { session: owner, body: { isActive: false } })).status).toBe(200);
    expect((await inBranch(owner, westlands, "GET", "/branches")).status).toBe(403); // deactivated branch cannot be worked in
  });

  it("never oversells the last unit when two tills sell at once", async () => {
    const t = await registerTenant("Race Shop");
    const p = await createProduct(t, { name: "Last one", costPrice: 10, sellingPrice: 20, stockQuantity: 1 });
    const b = (await post("/branches", t, { name: "Second" })).body.data.id;
    await post("/branches/transfers", t, { fromBranchId: (await get("/branches", t)).body.data[0].id, toBranchId: b, items: [{ productId: p.id, quantity: 1 }] });
    const results = await Promise.all([1, 2, 3].map(() => inBranch(t, b, "POST", "/sales", { items: [line(p.id, 1, 20)], paymentMethod: "cash", amountPaid: 20 })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await totalsMatch()).toBe(true);
  });
});

describe("reports by branch", () => {
  it("reports the whole business, or one branch, and keeps assigned staff to their own", async () => {
    const t = await registerTenant("Report Branches");
    const p = await createProduct(t, { name: "Thing", costPrice: 40, sellingPrice: 100, stockQuantity: 50 });
    const main = (await get("/branches", t)).body.data[0].id;
    const b = (await post("/branches", t, { name: "Annex" })).body.data.id;
    await post("/branches/transfers", t, { fromBranchId: main, toBranchId: b, items: [{ productId: p.id, quantity: 20 }] });
    await inBranch(t, main, "POST", "/sales", { items: [line(p.id, 2)], paymentMethod: "cash", amountPaid: 200 });
    await inBranch(t, b, "POST", "/sales", { items: [line(p.id, 5)], paymentMethod: "cash", amountPaid: 500 });
    await inBranch(t, b, "POST", "/expenses", { category: "Rent", amount: 70, description: "Annex rent" });
    const range = "startDate=2020-01-01&endDate=2030-12-31";
    const all = (await get(`/reports?${range}`, t)).body.data.summary;
    const one = (await get(`/reports?${range}&branchId=${b}`, t)).body.data.summary;
    const other = (await get(`/reports?${range}&branchId=${main}`, t)).body.data.summary;
    expect(all.totalSales).toBe(700);
    expect(one.totalSales).toBe(500);
    expect(other.totalSales).toBe(200);
    expect(one.totalExpenses).toBe(70);
    expect(other.totalExpenses).toBe(0);
    const acct = await addEmployee(t, "branch accountant", ["reports.view"]);
    await api("PUT", `/branches/staff/${acct.userId}`, { session: t, body: { branchId: main } });
    const mine = (await get(`/reports?${range}&branchId=${b}`, acct)).body.data.summary;
    expect(mine.totalSales).toBe(200); // asked for Annex, still sees only their own branch
  });
});

