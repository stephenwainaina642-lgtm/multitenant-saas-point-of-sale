import { describe, it, expect, beforeAll } from "vitest";
import { resetData } from "../support/db.js";
import { del, get, post, put } from "../support/http.js";
import { addEmployee, createProduct, seedPhoneShop } from "../support/seed.js";

describe("roles and permissions", () => {
  let s: Awaited<ReturnType<typeof seedPhoneShop>>;
  let sales: Awaited<ReturnType<typeof addEmployee>>;
  let cashier: Awaited<ReturnType<typeof addEmployee>>;

  beforeAll(async () => {
    await resetData();
    s = await seedPhoneShop();
    sales = await addEmployee(s.t, "Salesperson");
    cashier = await addEmployee(s.t, "Cashier");
  });

  it("an employee can reach the business, and a non-member cannot", async () => {
    expect((await get("/products", sales)).status).toBe(200);
    const other = await seedPhoneShop();
    expect((await get("/products", { token: other.t.token, businessId: s.t.businessId })).status).toBe(403);
  });

  it("a salesperson sees only their own sales; the owner sees all", async () => {
    const a = await post("/sales", sales, { items: [{ productId: s.charger.id, quantity: 1, unitPrice: 1200 }] });
    const b = await post("/sales", s.t, { items: [{ productId: s.charger.id, quantity: 1, unitPrice: 1200 }] });
    const mine = (await get("/sales", sales)).body.data.map((x: { id: string }) => x.id);
    expect(mine).toContain(a.body.data.id);
    expect(mine).not.toContain(b.body.data.id);
    const all = (await get("/sales", s.t)).body.data.map((x: { id: string }) => x.id);
    expect(all).toEqual(expect.arrayContaining([a.body.data.id, b.body.data.id]));
  });

  it("only the owner can edit business settings", async () => {
    expect((await put("/businesses/current", sales, { name: "Renamed" })).status).toBe(403);
    expect((await put("/businesses/current", s.t, { name: "Rongai Phone Hub" })).status).toBe(200);
  });

  // KD-1: there is no permission model in the backend. These assert the
  // behaviour the product requires; they fail today because every member can do everything.
  it.fails("KD-1 a salesperson cannot delete products", async () => {
    const p = await createProduct(s.t, { name: "Protected", costPrice: 1, sellingPrice: 2 });
    expect((await del(`/products/${p.id}`, sales)).status).toBe(403);
  });

  it.fails("KD-1 a salesperson cannot create or edit products", async () => {
    expect((await post("/products", sales, { name: "Rogue", costPrice: 1, sellingPrice: 2 })).status).toBe(403);
  });

  it.fails("KD-1 a salesperson cannot view business-wide reports", async () => {
    expect((await get("/reports", sales)).status).toBe(403);
  });

  it.fails("KD-1 a salesperson cannot adjust stock", async () => {
    const res = await post("/inventory", sales, { productId: s.iphone.id, type: "ADJUSTMENT", quantity: 0 });
    expect(res.status).toBe(403);
  });

  it.fails("KD-1 a salesperson cannot see expenses or the audit log", async () => {
    expect((await get("/expenses", sales)).status).toBe(403);
    expect((await get("/audit-logs", sales)).status).toBe(403);
  });

  it.fails("KD-1 a cashier cannot create purchases", async () => {
    const res = await post("/purchases", cashier, {
      supplierId: s.supplier.id, items: [{ productId: s.charger.id, quantity: 1, unitCost: 1 }],
    });
    expect(res.status).toBe(403);
  });
});
