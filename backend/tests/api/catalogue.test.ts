import { describe, it, expect, beforeAll } from "vitest";
import { query, resetData } from "../support/db.js";
import { del, get, post, put } from "../support/http.js";
import { addEmployee, registerTenant, seedPhoneShop, stockOf, type Tenant } from "../support/seed.js";

describe("products, customers, suppliers", () => {
  let s: Awaited<ReturnType<typeof seedPhoneShop>>;
  let other: Tenant;
  beforeAll(async () => { await resetData(); s = await seedPhoneShop(); other = await registerTenant("Other"); });

  const prod = (o: object = {}) => ({ name: "Cable", costPrice: 100, sellingPrice: 200, stockQuantity: 5, ...o });

  describe("products", () => {
    it("rejects invalid input", async () => {
      for (const bad of [
        { name: "  " }, { costPrice: -1 }, { sellingPrice: "abc" }, { stockQuantity: -3 },
        { minimumStock: -1 }, { sellingPrice: 10.555 }, { costPrice: 1e12 }, { stockQuantity: 1.2345 },
      ]) {
        const r = await post("/products", s.t, prod({ name: "Bad", ...bad }));
        expect(r.status, JSON.stringify(bad)).toBe(400);
      }
    });

    it("rejects duplicate SKU and barcode within a business but allows them across businesses", async () => {
      expect((await post("/products", s.t, prod({ name: "A1", sku: "SKU-1", barcode: "111" }))).status).toBe(201);
      expect((await post("/products", s.t, prod({ name: "A2", sku: "SKU-1" }))).status).toBe(409);
      expect((await post("/products", s.t, prod({ name: "A3", barcode: "111" }))).status).toBe(409);
      expect((await post("/products", other, prod({ name: "A1", sku: "SKU-1", barcode: "111" }))).status).toBe(201);
    });

    it("opening stock creates exactly one IN movement and the stock is explained by movements", async () => {
      const r = await post("/products", s.t, prod({ name: "Opening", stockQuantity: 7 }));
      const mv = await query(`select type, quantity from inventory_movements where product_id = $1`, [r.body.data.id]);
      expect(mv).toEqual([{ type: "IN", quantity: "7.000" }]);
    });

    it("update changes details but can never change stock, active flag or business", async () => {
      const r = await post("/products", s.t, prod({ name: "Edit me", stockQuantity: 4 }));
      const id = r.body.data.id;
      const u = await put(`/products/${id}`, s.t, { sellingPrice: 250, stockQuantity: 999, isActive: false, businessId: other.businessId });
      expect(u.status).toBe(200);
      expect(Number(u.body.data.sellingPrice)).toBe(250);
      expect(await stockOf(id)).toBe(4);
      const [row] = await query(`select is_active, business_id::text as b from products where id = $1`, [id]);
      expect(row).toEqual({ is_active: true, b: s.t.businessId });
    });

    it("update validates like create", async () => {
      const id = (await post("/products", s.t, prod({ name: "Valid" }))).body.data.id;
      expect((await put(`/products/${id}`, s.t, { name: "" })).status).toBe(400);
      expect((await put(`/products/${id}`, s.t, { sellingPrice: -5 })).status).toBe(400);
      expect((await put(`/products/${id}`, s.t, { sellingPrice: "x" })).status).toBe(400);
      expect((await put(`/products/${id}`, s.t, { minimumStock: -1 })).status).toBe(400);
    });

    it("archiving hides the product, keeps history, and blocks selling it", async () => {
      const p = (await post("/products", s.t, prod({ name: "Retire", sellingPrice: 300 }))).body.data;
      const sale = await post("/sales", s.t, { amountPaid: 300, paymentMethod: "cash", items: [{ productId: p.id, quantity: 1, unitPrice: 300 }] });
      expect(sale.status).toBe(201);
      expect((await del(`/products/${p.id}`, s.t)).status).toBe(200);
      const list = (await get("/products", s.t)).body.data.map((x: any) => x.id);
      expect(list).not.toContain(p.id);
      expect((await get(`/sales/${sale.body.data.id}`, s.t)).body.data.items).toHaveLength(1);
      expect((await post("/sales", s.t, { amountPaid: 300, paymentMethod: "cash", items: [{ productId: p.id, quantity: 1, unitPrice: 300 }] })).status).toBe(404);
      expect((await del(`/products/${p.id}`, s.t)).status).toBe(404);
    });

    it("unknown, malformed and foreign ids return 404/400, never another tenant's data", async () => {
      const mine = (await post("/products", s.t, prod({ name: "Private" }))).body.data.id;
      expect((await put(`/products/${mine}`, other, { name: "Stolen" })).status).toBe(404);
      expect((await del(`/products/${mine}`, other)).status).toBe(404);
      expect((await put(`/products/999999`, s.t, { name: "x" })).status).toBe(404);
      expect((await put(`/products/abc`, s.t, { name: "x" })).status).toBe(400);
      expect((await get("/products", other)).body.data.map((p: any) => p.id)).not.toContain(mine);
    });

    it("permissions: cashier can view but not create, edit or archive", async () => {
      const csh = await addEmployee(s.t, "Cashier");
      const id = (await post("/products", s.t, prod({ name: "Perm" }))).body.data.id;
      expect((await get("/products", csh)).status).toBe(200);
      expect((await post("/products", csh, prod({ name: "Nope" }))).status).toBe(403);
      expect((await put(`/products/${id}`, csh, { name: "Nope" })).status).toBe(403);
      expect((await del(`/products/${id}`, csh)).status).toBe(403);
    });

    it("stock adjustments record a movement and cannot take stock below zero", async () => {
      const id = (await post("/products", s.t, prod({ name: "Adjust", stockQuantity: 5 }))).body.data.id;
      const inc = await post("/inventory", s.t, { productId: id, type: "IN", quantity: 3, notes: "found" });
      expect(inc.status).toBe(201);
      expect(await stockOf(id)).toBe(8);
      const out = await post("/inventory", s.t, { productId: id, type: "OUT", quantity: 100 });
      expect(out.status).toBe(400);
      expect(await stockOf(id)).toBe(8);
      expect((await post("/inventory", s.t, { productId: id, type: "IN", quantity: -1 })).status).toBe(400);
      expect((await post("/inventory", s.t, { productId: id, type: "TELEPORT", quantity: 1 })).status).toBe(400);
    });
  });

  describe("customers", () => {
    it("lists balance and credit limit, and accepts a credit limit on create and update", async () => {
      const c = await post("/customers", s.t, { name: "Limit Ltd", creditLimit: 5000 });
      expect(c.status).toBe(201);
      expect(Number(c.body.data.creditLimit)).toBe(5000);
      expect(Number(c.body.data.balance)).toBe(0);
      const u = await put(`/customers/${c.body.data.id}`, s.t, { creditLimit: 8000, balance: 123456 });
      expect(u.status).toBe(200);
      expect(Number(u.body.data.creditLimit)).toBe(8000);
      const row = (await get("/customers", s.t)).body.data.find((x: any) => x.id === c.body.data.id);
      expect(Number(row.balance)).toBe(0); // balance is derived from sales, never writable
      expect(Number(row.creditLimit)).toBe(8000);
    });

    it("rejects invalid input", async () => {
      for (const bad of [{ name: "   " }, { name: "x".repeat(300) }, { email: "not-an-email" }, { creditLimit: -1 }, { creditLimit: "abc" }, { phone: "x".repeat(60) }]) {
        expect((await post("/customers", s.t, { name: "Bad", ...bad })).status, JSON.stringify(bad)).toBe(400);
      }
    });

    it("cannot archive a customer who still owes money; can once settled", async () => {
      const c = (await post("/customers", s.t, { name: "Debtor", creditLimit: 10000 })).body.data;
      const p = (await post("/products", s.t, prod({ name: "Credit item", sellingPrice: 1000 }))).body.data;
      const sale = (await post("/sales", s.t, { customerId: c.id, items: [{ productId: p.id, quantity: 1, unitPrice: 1000 }] })).body.data;
      const blocked = await del(`/customers/${c.id}`, s.t);
      expect(blocked.status).toBe(409);
      expect(blocked.body.message).toMatch(/outstanding balance/);
      await post("/payments", s.t, { saleId: sale.id, amount: 1000, method: "cash" });
      expect((await del(`/customers/${c.id}`, s.t)).status).toBe(200);
    });

    it("tenant isolation and permissions", async () => {
      const c = (await post("/customers", s.t, { name: "Mine" })).body.data;
      expect((await put(`/customers/${c.id}`, other, { name: "Stolen" })).status).toBe(404);
      expect((await del(`/customers/${c.id}`, other)).status).toBe(404);
      expect((await get("/customers", other)).body.data.map((x: any) => x.id)).not.toContain(c.id);
      expect((await put(`/customers/abc`, s.t, { name: "x" })).status).toBe(400);
      const acct = await addEmployee(s.t, "Accountant");
      expect((await post("/customers", acct, { name: "No" })).status).toBe(403);
    });
  });

  describe("suppliers", () => {
    it("lists balance, validates input and enforces isolation", async () => {
      const r = await post("/suppliers", s.t, { name: "Nairobi Wholesale", phone: "0700111222" });
      expect(r.status).toBe(201);
      expect(Number(r.body.data.balance)).toBe(0);
      for (const bad of [{ name: " " }, { email: "bad" }, { name: "y".repeat(300) }]) {
        expect((await post("/suppliers", s.t, { name: "Bad", ...bad })).status, JSON.stringify(bad)).toBe(400);
      }
      const u = await put(`/suppliers/${r.body.data.id}`, s.t, { name: "Nairobi Wholesale Ltd", balance: 99999 });
      expect(u.status).toBe(200);
      const row = (await get("/suppliers", s.t)).body.data.find((x: any) => x.id === r.body.data.id);
      expect(Number(row.balance)).toBe(0);
      expect((await put(`/suppliers/${r.body.data.id}`, other, { name: "Stolen" })).status).toBe(404);
      expect((await del(`/suppliers/${r.body.data.id}`, other)).status).toBe(404);
      expect((await del(`/suppliers/${r.body.data.id}`, s.t)).status).toBe(200);
      expect((await get("/suppliers", s.t)).body.data.map((x: any) => x.id)).not.toContain(r.body.data.id);
    });
  });
});
