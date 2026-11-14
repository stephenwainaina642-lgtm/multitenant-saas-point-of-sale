import { describe, it, expect, beforeAll } from "vitest";
import { query, resetData } from "../support/db.js";
import { del, get, post, put } from "../support/http.js";
import {
  addEmployee, createProduct, registerTenant, seedHardwareStore, seedPhoneShop,
  type Tenant,
} from "../support/seed.js";

const REPORTS = "/reports?startDate=2026-01-01&endDate=2026-12-31";
const sale = (productId: string) => ({
  amountPaid: 1200, paymentMethod: "cash",
  items: [{ productId, quantity: 1, unitPrice: 1200 }],
});

describe("roles and permissions (enforced in the backend)", () => {
  let s: Awaited<ReturnType<typeof seedPhoneShop>>;
  let sales: Tenant;
  let cashier: Tenant;
  let manager: Tenant;
  let stockman: Tenant;

  beforeAll(async () => {
    await resetData();
    s = await seedPhoneShop();
    sales = await addEmployee(s.t, "Salesperson");
    cashier = await addEmployee(s.t, "Cashier");
    manager = await addEmployee(s.t, "Manager");
    stockman = await addEmployee(s.t, "Inventory Manager");
  });

  it("a non-member cannot use the business at all", async () => {
    const other = await seedHardwareStore();
    expect((await get("/products", { token: other.t.token, businessId: s.t.businessId })).status).toBe(403);
  });

  it("the owner can do everything, including settings and roles", async () => {
    expect((await get(REPORTS, s.t)).status).toBe(200);
    expect((await get("/roles", s.t)).status).toBe(200);
    expect((await put("/businesses/current", s.t, { name: "Rongai Phone Hub" })).status).toBe(200);
  });

  describe("salesperson", () => {
    it("can work the till: view products and customers, sell, and take payments", async () => {
      expect((await get("/products", sales)).status).toBe(200);
      expect((await get("/customers", sales)).status).toBe(200);
      const res = await post("/sales", sales, sale(s.charger.id));
      expect(res.status).toBe(201);
      expect((await get(`/sales/${res.body.data.id}`, sales)).status).toBe(200);
    });

    it("sees only their own sales; the owner sees all", async () => {
      const a = await post("/sales", sales, sale(s.charger.id));
      const b = await post("/sales", s.t, sale(s.charger.id));
      const mine = (await get("/sales", sales)).body.data.map((x: { id: string }) => x.id);
      expect(mine).toContain(a.body.data.id);
      expect(mine).not.toContain(b.body.data.id);
      const all = (await get("/sales", s.t)).body.data.map((x: { id: string }) => x.id);
      expect(all).toEqual(expect.arrayContaining([a.body.data.id, b.body.data.id]));
    });

    it("can record a payment only on their own sales", async () => {
      const own = await post("/sales", sales, { customerId: s.customer.id, items: [{ productId: s.charger.id, quantity: 1, unitPrice: 1200 }] });
      const others = await post("/sales", s.t, { customerId: s.customer.id, items: [{ productId: s.charger.id, quantity: 1, unitPrice: 1200 }] });
      expect((await post("/payments", sales, { saleId: own.body.data.id, amount: 200, method: "cash" })).status).toBe(201);
      const denied = await post("/payments", sales, { saleId: others.body.data.id, amount: 200, method: "cash" });
      expect(denied.status).toBe(404);
      const [row] = await query(`select amount_paid from sales where id = $1`, [others.body.data.id]);
      expect(Number(row!.amount_paid)).toBe(0);
    });

    it("cannot manage products, stock, purchases, suppliers, expenses, reports, audit log, roles or settings", async () => {
      const p = await createProduct(s.t, { name: "Protected", costPrice: 1, sellingPrice: 2 });
      const checks: [string, number][] = [
        ["delete product", (await del(`/products/${p.id}`, sales)).status],
        ["create product", (await post("/products", sales, { name: "Rogue", costPrice: 1, sellingPrice: 2 })).status],
        ["edit product", (await put(`/products/${p.id}`, sales, { name: "Renamed" })).status],
        ["adjust stock", (await post("/inventory", sales, { productId: s.iphone.id, type: "ADJUSTMENT", quantity: 0 })).status],
        ["view stock movements", (await get("/inventory", sales)).status],
        ["purchase", (await post("/purchases", sales, { supplierId: s.supplier.id, items: [{ productId: s.charger.id, quantity: 1, unitCost: 1 }] })).status],
        ["view suppliers", (await get("/suppliers", sales)).status],
        ["view expenses", (await get("/expenses", sales)).status],
        ["create expense", (await post("/expenses", sales, { category: "x", amount: 1 })).status],
        ["view reports", (await get(REPORTS, sales)).status],
        ["view audit log", (await get("/audit-logs", sales)).status],
        ["view all payments", (await get("/payments", sales)).status],
        ["view invoices", (await get("/invoices", sales)).status],
        ["list roles", (await get("/roles", sales)).status],
        ["create role", (await post("/roles", sales, { name: "Boss", permissions: ["roles.manage"] })).status],
        ["edit settings", (await put("/businesses/current", sales, { name: "Renamed" })).status],
      ];
      for (const [what, status] of checks) expect(status, what).toBe(403);
      const [still] = await query(`select is_active, name from products where id = $1`, [p.id]);
      expect(still).toEqual({ is_active: true, name: "Protected" });
    });
  });

  describe("cashier", () => {
    it("can sell but cannot create purchases or manage customers", async () => {
      expect((await post("/sales", cashier, sale(s.charger.id))).status).toBe(201);
      expect((await post("/purchases", cashier, { supplierId: s.supplier.id, items: [{ productId: s.charger.id, quantity: 1, unitCost: 1 }] })).status).toBe(403);
      expect((await post("/customers", cashier, { name: "Walk in" })).status).toBe(403);
    });
  });

  describe("inventory manager", () => {
    it("manages products and stock but cannot sell, see reports or take payments", async () => {
      const p = await post("/products", stockman, { name: "New Cable", costPrice: 10, sellingPrice: 20, stockQuantity: 5 });
      expect(p.status).toBe(201);
      expect((await post("/inventory", stockman, { productId: p.body.data.id, type: "IN", quantity: 3 })).status).toBe(201);
      expect((await post("/purchases", stockman, { supplierId: s.supplier.id, items: [{ productId: p.body.data.id, quantity: 2, unitCost: 10 }] })).status).toBe(201);
      expect((await post("/sales", stockman, sale(p.body.data.id))).status).toBe(403);
      expect((await get(REPORTS, stockman)).status).toBe(403);
      expect((await post("/payments", stockman, { saleId: "1", amount: 1, method: "cash" })).status).toBe(403);
    });
  });

  describe("manager", () => {
    it("has broad access but cannot manage roles or business settings", async () => {
      expect((await get(REPORTS, manager)).status).toBe(200);
      expect((await get("/expenses", manager)).status).toBe(200);
      expect((await post("/products", manager, { name: "Mgr item", costPrice: 1, sellingPrice: 2 })).status).toBe(201);
      expect((await get("/roles", manager)).status).toBe(403);
      expect((await put("/businesses/current", manager, { name: "Mine now" })).status).toBe(403);
    });
  });

  describe("custom roles", () => {
    it("the owner creates a role with granular permissions and it is enforced", async () => {
      const created = await post("/roles", s.t, { name: "Stock Clerk", permissions: ["products.view", "inventory.view"] });
      expect(created.status).toBe(201);
      const clerk = await addEmployee(s.t, "Stock Clerk", ["products.view", "inventory.view"]);
      expect((await get("/products", clerk)).status).toBe(200);
      expect((await get("/inventory", clerk)).status).toBe(200);
      expect((await post("/inventory", clerk, { productId: s.charger.id, type: "IN", quantity: 1 })).status).toBe(403);
      expect((await post("/sales", clerk, sale(s.charger.id))).status).toBe(403);
    });

    it("a custom role's permissions override a built-in name's defaults", async () => {
      const restricted = await addEmployee(s.t, "Cashier Lite", ["sales.create", "products.view"]);
      expect((await post("/sales", restricted, sale(s.charger.id))).status).toBe(201);
      expect((await get("/customers", restricted)).status).toBe(403);
    });

    it("a role with no permissions and an unknown name grants nothing", async () => {
      const nobody = await addEmployee(s.t, "Visitor");
      expect((await get("/products", nobody)).status).toBe(403);
      expect((await get("/sales", nobody)).status).toBe(403);
    });

    it("validates role input", async () => {
      expect((await post("/roles", s.t, { name: "", permissions: ["products.view"] })).status).toBe(400);
      expect((await post("/roles", s.t, { name: "Empty", permissions: [] })).status).toBe(400);
      expect((await post("/roles", s.t, { name: "Typo", permissions: ["products.vieww"] })).status).toBe(400);
      expect((await post("/roles", s.t, { name: "Owner", permissions: ["products.view"] })).status).toBe(400);
      expect((await post("/roles", s.t, { name: "stock clerk", permissions: ["products.view"] })).status).toBe(409);
    });

    it("the owner role cannot be edited or deleted, and a role in use cannot be deleted", async () => {
      const roles = (await get("/roles", s.t)).body.data as { id: string; name: string }[];
      const owner = roles.find((r) => r.name.toLowerCase() === "owner");
      if (owner) {
        expect((await put(`/roles/${owner.id}`, s.t, { permissions: ["products.view"] })).status).toBe(400);
        expect((await del(`/roles/${owner.id}`, s.t)).status).toBe(400);
      }
      const inUse = roles.find((r) => r.name === "Stock Clerk")!;
      expect((await del(`/roles/${inUse.id}`, s.t)).status).toBe(409);
      const spare = await post("/roles", s.t, { name: "Spare", permissions: ["products.view"] });
      expect((await put(`/roles/${spare.body.data.id}`, s.t, { permissions: ["products.view", "customers.view"] })).status).toBe(200);
      expect((await del(`/roles/${spare.body.data.id}`, s.t)).status).toBe(200);
    });

    it("exposes the permission catalog with the built-in role defaults", async () => {
      const res = await get("/roles/permissions", s.t);
      expect(res.status).toBe(200);
      expect(res.body.data.permissions.length).toBeGreaterThan(20);
      expect(res.body.data.builtInRoles.map((r: { name: string }) => r.name)).toContain("salesperson");
    });
  });

  describe("roles are isolated between businesses", () => {
    it("business B cannot see, edit or delete business A's custom roles, and names do not clash", async () => {
      const b = await registerTenant("Other Co");
      const aRole = (await post("/roles", s.t, { name: "Shared Name", permissions: ["products.view"] })).body.data;
      const bRole = await post("/roles", b, { name: "Shared Name", permissions: ["reports.view"] });
      expect(bRole.status).toBe(201);
      const listB = (await get("/roles", b)).body.data.map((r: { id: string }) => r.id);
      expect(listB).not.toContain(aRole.id);
      expect((await put(`/roles/${aRole.id}`, b, { permissions: ["reports.view"] })).status).toBe(404);
      expect((await del(`/roles/${aRole.id}`, b)).status).toBe(404);
      const [row] = await query(`select permissions from roles where id = $1`, [aRole.id]);
      expect(row!.permissions).toEqual(["products.view"]);
    });
  });
});
