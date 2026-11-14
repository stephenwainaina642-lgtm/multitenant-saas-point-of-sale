import { describe, it, expect, beforeAll } from "vitest";
import { query, resetData } from "../support/db.js";
import { del, get, post, put } from "../support/http.js";
import {
  createCustomer, createProduct, createSupplier, registerTenant,
  seedPhoneShop, seedHardwareStore, stockOf, type Tenant,
} from "../support/seed.js";

// Two real businesses, exercised through the HTTP API (not the UI).
describe("tenant isolation (direct API requests)", () => {
  let a: Awaited<ReturnType<typeof seedPhoneShop>>;
  let b: Awaited<ReturnType<typeof seedHardwareStore>>;
  let saleA: { id: string };
  let purchaseA: { id: string };

  beforeAll(async () => {
    await resetData();
    a = await seedPhoneShop();
    b = await seedHardwareStore();
    const sale = await post("/sales", a.t, {
      customerId: a.customer.id, amountPaid: 1000, paymentMethod: "cash",
      items: [{ productId: a.charger.id, quantity: 2, unitPrice: 1200 }],
    });
    expect(sale.status).toBe(201);
    saleA = sale.body.data;
    const purchase = await post("/purchases", a.t, {
      supplierId: a.supplier.id,
      items: [{ productId: a.charger.id, quantity: 10, unitCost: 650 }],
    });
    expect(purchase.status).toBe(201);
    purchaseA = purchase.body.data;
    await post("/expenses", a.t, { category: "rent", amount: 15000 });
  });

  const idsOf = (res: { body: any }) => (res.body.data as { id: string }[]).map((r) => r.id);

  it.each([
    ["products", () => a.iphone.id],
    ["customers", () => a.customer.id],
    ["suppliers", () => a.supplier.id],
    ["purchases", () => purchaseA.id],
    ["sales", () => saleA.id],
  ])("business B's %s list never contains business A's records", async (path, aId) => {
    const resB = await get(`/${path}`, b.t);
    expect(resB.status).toBe(200);
    expect(idsOf(resB)).not.toContain(aId());
    // and A can see its own record (guards against a vacuous pass)
    const resA = await get(`/${path}`, a.t);
    expect(idsOf(resA)).toContain(aId());
  });

  it("B's payments, expenses, inventory and reports contain none of A's data", async () => {
    for (const path of ["/payments", "/expenses", "/invoices", "/quotations", "/audit-logs"]) {
      const res = await get(path, b.t);
      expect(res.status, path).toBeLessThan(500);
      if (Array.isArray(res.body.data)) {
        expect(res.body.data.length, path).toBe(0);
      }
    }
    // B has its own opening-stock movements; none may belong to A's products.
    const inv = await get("/inventory", b.t);
    expect(inv.status).toBe(200);
    const aProductIds = [a.iphone.id, a.galaxy.id, a.charger.id];
    for (const m of inv.body.data as { productId: string }[]) {
      expect(aProductIds).not.toContain(m.productId);
    }
    const reportB = await get("/reports?startDate=2026-01-01&endDate=2026-12-31", b.t);
    expect(reportB.status).toBe(200);
    const reportA = await get("/reports?startDate=2026-01-01&endDate=2026-12-31", a.t);
    expect(reportA.status).toBe(200);
    // A has a KES 2,400 sale today; B has none, so the two reports must differ.
    expect(JSON.stringify(reportB.body)).not.toEqual(JSON.stringify(reportA.body));
  });

  it("B cannot use A's business id: membership check returns 403", async () => {
    const res = await get("/products", { token: b.t.token, businessId: a.t.businessId });
    expect(res.status).toBe(403);
    const write = await post("/products", { token: b.t.token, businessId: a.t.businessId }, {
      name: "Injected", costPrice: 1, sellingPrice: 2,
    });
    expect(write.status).toBe(403);
    const rows = await query(`select 1 from products where name = 'Injected'`);
    expect(rows.length).toBe(0);
  });

  it("B cannot read A's sale by id", async () => {
    const res = await get(`/sales/${saleA.id}`, b.t);
    expect(res.status).toBe(404);
  });

  it("B cannot modify or delete A's product", async () => {
    const before = await query(`select name, selling_price, is_active from products where id = $1`, [a.iphone.id]);
    const upd = await put(`/products/${a.iphone.id}`, b.t, { name: "Hacked", sellingPrice: 1 });
    const del_ = await del(`/products/${a.iphone.id}`, b.t);
    expect(upd.status).toBeGreaterThanOrEqual(400);
    expect(del_.status).toBeGreaterThanOrEqual(400);
    const after = await query(`select name, selling_price, is_active from products where id = $1`, [a.iphone.id]);
    expect(after).toEqual(before);
  });

  it("B cannot sell A's product and A's stock is untouched", async () => {
    const stock = await stockOf(a.iphone.id);
    const res = await post("/sales", b.t, {
      items: [{ productId: a.iphone.id, quantity: 1, unitPrice: 112000 }],
    });
    expect(res.status).toBe(404);
    expect(await stockOf(a.iphone.id)).toBe(stock);
  });

  it("B cannot attach A's customer to a sale", async () => {
    const res = await post("/sales", b.t, {
      customerId: a.customer.id,
      items: [{ productId: b.cement.id, quantity: 1, unitPrice: 780 }],
    });
    expect(res.status).toBe(404);
  });

  it("B cannot record a payment against A's sale", async () => {
    const res = await post("/payments", b.t, { saleId: saleA.id, amount: 100, method: "cash" });
    expect(res.status).toBe(404);
    const [row] = await query(`select amount_paid from sales where id = $1`, [saleA.id]);
    expect(Number(row!.amount_paid)).toBe(1000);
  });

  it("B cannot buy from A's supplier or receive stock into A's product", async () => {
    const stock = await stockOf(a.charger.id);
    const r1 = await post("/purchases", b.t, {
      supplierId: a.supplier.id, items: [{ productId: b.cement.id, quantity: 1, unitCost: 1 }],
    });
    const r2 = await post("/purchases", b.t, {
      supplierId: b.supplier.id, items: [{ productId: a.charger.id, quantity: 5, unitCost: 1 }],
    });
    expect(r1.status).toBeGreaterThanOrEqual(400);
    expect(r2.status).toBeGreaterThanOrEqual(400);
    expect(await stockOf(a.charger.id)).toBe(stock);
  });

  it("B cannot adjust A's stock through the inventory endpoint", async () => {
    const stock = await stockOf(a.iphone.id);
    const res = await post("/inventory", b.t, { productId: a.iphone.id, type: "ADJUSTMENT", quantity: 999 });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await stockOf(a.iphone.id)).toBe(stock);
  });

  it("the same SKU / barcode may exist independently in two businesses", async () => {
    const x: Tenant = await registerTenant("SKU Shop X");
    const y: Tenant = await registerTenant("SKU Shop Y");
    await createProduct(x, { name: "Item", sku: "SHARED-1", barcode: "999", costPrice: 1, sellingPrice: 2 });
    await expect(
      createProduct(y, { name: "Item", sku: "SHARED-1", barcode: "999", costPrice: 1, sellingPrice: 2 })
    ).resolves.toBeTruthy();
    // ...but not twice inside one business
    const dup = await post("/products", x, { name: "Item2", sku: "SHARED-1", costPrice: 1, sellingPrice: 2 });
    expect(dup.status).toBeGreaterThanOrEqual(400);
    expect(dup.status).toBeLessThan(500);
  });

  it("customers and suppliers with identical names stay separate per business", async () => {
    const c1 = await createCustomer(a.t, "Same Name");
    const c2 = await createCustomer(b.t, "Same Name");
    const listB = idsOf(await get("/customers", b.t));
    expect(listB).toContain(c2.id);
    expect(listB).not.toContain(c1.id);
    const s = await createSupplier(a.t, "Shared Supplier Name");
    expect(idsOf(await get("/suppliers", b.t))).not.toContain(s.id);
  });
});
