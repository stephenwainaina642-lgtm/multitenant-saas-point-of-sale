import { describe, it, expect, beforeAll } from "vitest";
import { query, resetData } from "../support/db.js";
import { get, post } from "../support/http.js";
import { addEmployee, ledgerViolations, registerTenant, seedPerfumeBusiness, stockOf, type Tenant } from "../support/seed.js";

const N = (v: unknown) => Number(v);

describe("purchases on credit, supplier payments and voiding", () => {
  let s: Awaited<ReturnType<typeof seedPerfumeBusiness>>;
  let other: Tenant;
  beforeAll(async () => { await resetData(); s = await seedPerfumeBusiness(); other = await registerTenant("Other"); });

  const supplierBalance = async () => N((await query(`select balance from suppliers where public_id = $1::uuid`, [s.supplier.id]))[0]!.balance);
  const buy = async (qty: number, cost: number, paid = 0, extra: object = {}) => {
    const r = await post("/purchases", s.t, {
      supplierId: s.supplier.id, amountPaid: paid, ...(paid > 0 && { paymentMethod: "bank" }),
      items: [{ productId: s.oud6.id, quantity: qty, unitCost: cost }], ...extra,
    });
    expect(r.status).toBe(201);
    return r.body.data as { id: string; total: string; paymentStatus?: string };
  };

  it("an unpaid purchase increases what we owe the supplier; supplier list shows it", async () => {
    const before = await supplierBalance();
    const p = await buy(10, 100); // 1000 owed
    expect(await supplierBalance()).toBe(before + 1000);
    expect((await get("/suppliers", s.t)).body.data.find((x: any) => x.id === s.supplier.id).balance).toBe((before + 1000).toFixed(2));
    expect(p.paymentStatus ?? (await get(`/purchases/${p.id}`, s.t)).body.data.paymentStatus).toBe("unpaid");
    expect(await ledgerViolations()).toEqual([]);
  });

  it("paying at purchase time needs a method and creates a payment record", async () => {
    const noMethod = await post("/purchases", s.t, { supplierId: s.supplier.id, amountPaid: 500, items: [{ productId: s.oud6.id, quantity: 5, unitCost: 100 }] });
    expect(noMethod.status).toBe(400);
    const before = await supplierBalance();
    const p = await buy(10, 100, 400); // 1000 total, 400 paid
    expect(await supplierBalance()).toBe(before + 600);
    const d = (await get(`/purchases/${p.id}`, s.t)).body.data;
    expect(d.paymentStatus).toBe("partial");
    expect(d.payments).toHaveLength(1);
    expect(N(d.payments[0].amount)).toBe(400);
    expect(await ledgerViolations()).toEqual([]);
  });

  it("later payments reduce the balance until paid; overpaying and zero are rejected", async () => {
    const p = await buy(10, 100, 0);
    const before = await supplierBalance();
    expect((await post(`/purchases/${p.id}/payments`, s.t, { amount: 0, method: "cash" })).status).toBe(400);
    expect((await post(`/purchases/${p.id}/payments`, s.t, { amount: 100 })).status).toBe(400);
    expect((await post(`/purchases/${p.id}/payments`, s.t, { amount: 1000.01, method: "cash" })).status).toBe(400);
    const a = await post(`/purchases/${p.id}/payments`, s.t, { amount: 300, method: "mpesa", reference: "QK1" });
    expect(a.status).toBe(201);
    expect(a.body.data.paymentStatus).toBe("partial");
    expect(await supplierBalance()).toBe(before - 300);
    const b = await post(`/purchases/${p.id}/payments`, s.t, { amount: 700, method: "cash" });
    expect(b.body.data.paymentStatus).toBe("paid");
    expect(N(b.body.data.balanceDue)).toBe(0);
    expect(await supplierBalance()).toBe(before - 1000);
    expect((await post(`/purchases/${p.id}/payments`, s.t, { amount: 1, method: "cash" })).status).toBe(409);
    expect(await ledgerViolations()).toEqual([]);
  });

  it("simultaneous payments never overpay a purchase", async () => {
    const p = await buy(10, 100, 0);
    const rs = await Promise.all(Array.from({ length: 6 }, () => post(`/purchases/${p.id}/payments`, s.t, { amount: 400, method: "cash" })));
    expect(rs.filter((r) => r.status === 201)).toHaveLength(2); // 400 + 400 <= 1000 < 1200
    expect(N((await get(`/purchases/${p.id}`, s.t)).body.data.amountPaid)).toBe(800);
    expect(await ledgerViolations()).toEqual([]);
  });

  it("voiding an unpaid purchase removes the stock and the debt; double void and payments are refused", async () => {
    const stock = await stockOf(s.oud6.id);
    const owed = await supplierBalance();
    const p = await buy(5, 100, 0);
    expect((await post(`/purchases/${p.id}/void`, s.t, {})).status).toBe(400);
    const v = await post(`/purchases/${p.id}/void`, s.t, { reason: "Wrong invoice" });
    expect(v.status).toBe(200);
    expect(v.body.data.status).toBe("voided");
    expect(await stockOf(s.oud6.id)).toBe(stock);
    expect(await supplierBalance()).toBe(owed);
    expect((await post(`/purchases/${p.id}/void`, s.t, { reason: "again" })).status).toBe(409);
    expect((await post(`/purchases/${p.id}/payments`, s.t, { amount: 10, method: "cash" })).status).toBe(409);
    const [a] = await query(`select action from audit_logs where entity = 'purchase' and entity_id = (select id from purchases where public_id = $1::uuid)`, [p.id]);
    expect(a!.action).toBe("purchase.void");
    expect(await ledgerViolations()).toEqual([]);
  });

  it("a purchase with payments, or whose stock was already sold, cannot be voided", async () => {
    const paid = await buy(5, 100, 100);
    const r1 = await post(`/purchases/${paid.id}/void`, s.t, { reason: "x" });
    expect(r1.status).toBe(409);
    expect(r1.body.message).toMatch(/payments recorded/);

    const p = await buy(3, 100, 0);
    const stock = await stockOf(s.oud6.id);
    await query(`update branch_stock set quantity = 0 where product_id = (select id from products where public_id = $1)`, [s.oud6.id]); // stock sold since
    const r2 = await post(`/purchases/${p.id}/void`, s.t, { reason: "x" });
    expect(r2.status).toBe(409);
    expect(r2.body.message).toMatch(/already been sold/);
    await query(`update branch_stock set quantity = $2 where product_id = (select id from products where public_id = $1)`, [s.oud6.id, stock]);
    expect(N((await get(`/purchases/${p.id}`, s.t)).body.data.items[0].quantity)).toBe(3);
  });

  it("supplier with a balance cannot be archived", async () => {
    await buy(1, 100, 0);
    const r = await (await import("../support/http.js")).del(`/suppliers/${s.supplier.id}`, s.t);
    expect(r.status).toBe(409);
  });

  it("permissions and tenant isolation", async () => {
    const p = await buy(2, 100, 0);
    const cashier = await addEmployee(s.t, "Cashier");
    const acct = await addEmployee(s.t, "Accountant");
    const inv = await addEmployee(s.t, "Inventory Manager");
    expect((await post(`/purchases/${p.id}/payments`, cashier, { amount: 10, method: "cash" })).status).toBe(403);
    expect((await post(`/purchases/${p.id}/payments`, inv, { amount: 10, method: "cash" })).status).toBe(403);
    expect((await post(`/purchases/${p.id}/payments`, acct, { amount: 10, method: "cash" })).status).toBe(201);
    expect((await post(`/purchases/${p.id}/void`, acct, { reason: "x" })).status).toBe(403);
    expect((await get(`/purchases/${p.id}`, other)).status).toBe(404);
    expect((await post(`/purchases/${p.id}/payments`, other, { amount: 10, method: "cash" })).status).toBe(404);
    expect((await post(`/purchases/${p.id}/void`, other, { reason: "x" })).status).toBe(404);
    expect((await get(`/purchases/abc`, s.t)).status).toBe(400);
    expect((await get(`/purchases/1`, s.t)).status).toBe(400); // a sequential id is refused
    expect((await get(`/purchases/3f2b1c1e-9d4a-4c55-8a1e-0b9f6d7e1a42`, s.t)).status).toBe(404);
  });
});
