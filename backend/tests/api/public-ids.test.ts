import { describe, it, expect, beforeAll } from "vitest";
import pg from "pg";
import { applyMigrations, query, resetData } from "../support/db.js";
import { loadTestConfig } from "../support/env.js";
import { del, get, post, put } from "../support/http.js";
import { registerTenant, type Tenant } from "../support/seed.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("categories use random public ids", () => {
  let a: Tenant;
  let b: Tenant;
  beforeAll(async () => { await resetData(); a = await registerTenant("Pub A"); b = await registerTenant("Pub B"); });

  it("shows only random ids, never the sequential database id, everywhere categories appear", async () => {
    const c = await post("/categories", a, { name: "Phones" });
    expect(c.body.data.id).toMatch(UUID);
    const row = (await query(`select id, public_id from categories where name = 'Phones' and business_id = $1`, [a.businessId]))[0]!;
    expect(c.body.data.id).toBe(row.public_id);
    expect(c.body.data.id).not.toBe(String(row.id));

    const p = await post("/products", a, { name: "X", costPrice: 1, sellingPrice: 2, categoryId: c.body.data.id });
    expect(p.status).toBe(201);
    expect(p.body.data.categoryId).toBe(c.body.data.id);
    expect((await get("/products", a)).body.data[0].categoryId).toBe(c.body.data.id);
    const upd = await put(`/products/${p.body.data.id}`, a, { categoryId: c.body.data.id });
    expect(upd.status, JSON.stringify(upd.body)).toBe(200);
    expect(upd.body.data.categoryId).toBe(c.body.data.id);
    for (const cat of (await get("/categories", a)).body.data) expect(cat.id).toMatch(UUID);
  });

  it("refuses the old numeric id (and junk) for categories, on its own routes and on products", async () => {
    const c = await post("/categories", a, { name: "Numeric" });
    const row = (await query(`select id from categories where public_id = $1`, [c.body.data.id]))[0]!;
    const numeric = String(row.id);
    expect((await put(`/categories/${numeric}`, a, { name: "Hacked" })).status).toBe(400);
    expect((await del(`/categories/${numeric}`, a)).status).toBe(400);
    expect((await put(`/categories/not-a-uuid`, a, { name: "Hacked" })).status).toBe(400);
    expect((await post("/products", a, { name: "Y", costPrice: 1, sellingPrice: 2, categoryId: numeric })).status).toBe(400);
    expect((await post("/products", a, { name: "Y", costPrice: 1, sellingPrice: 2, categoryId: "1' or '1'='1" })).status).toBe(400);
    const still = await query(`select name from categories where public_id = $1`, [c.body.data.id]);
    expect(still[0]!.name).toBe("Numeric");
  });

  it("another business's public id is still refused, and a random UUID that does not exist is 404", async () => {
    const theirs = (await post("/categories", b, { name: "Theirs" })).body.data.id;
    expect((await put(`/categories/${theirs}`, a, { name: "Mine now" })).status).toBe(404);
    expect((await del(`/categories/${theirs}`, a)).status).toBe(404);
    expect((await post("/products", a, { name: "Z", costPrice: 1, sellingPrice: 2, categoryId: theirs })).status).toBe(400);
    expect((await put(`/categories/00000000-0000-4000-8000-000000000000`, a, { name: "none" })).status).toBe(404);
    expect((await get("/categories", b)).body.data[0].name).toBe("Theirs");
  });

  it("the category-sales report uses the public id too", async () => {
    const c = (await post("/categories", a, { name: "Reported" })).body.data.id;
    const p = (await post("/products", a, { name: "Rep", costPrice: 10, sellingPrice: 20, stockQuantity: 5, categoryId: c })).body.data;
    expect((await post("/sales", a, { amountPaid: 20, paymentMethod: "cash", items: [{ productId: p.id, quantity: 1, unitPrice: 20 }] })).status).toBe(201);
    const RANGE = "startDate=2026-01-01&endDate=2026-12-31";
    const rep = await get(`/reports?${RANGE}`, a);
    expect(rep.status, JSON.stringify(rep.body).slice(0, 200)).toBe(200);
    const mine = rep.body.data.salesByCategory.find((x: any) => x.categoryName === "Reported");
    expect(mine.categoryId).toBe(c);
  });
});

describe("public id migration on a database with existing categories", () => {
  it("gives every existing category its own random id, keeps every row, and rejects duplicates", async () => {
    const cfg = loadTestConfig();
    const name = `${cfg.dbName}_publicid_upgrade_test`;
    expect(name.endsWith("_test")).toBe(true);
    const admin = new pg.Client({ connectionString: cfg.adminUrl });
    await admin.connect();
    await admin.query(`drop database if exists "${name}" with (force)`);
    await admin.query(`create database "${name}"`);
    const url = new URL(cfg.databaseUrl);
    url.pathname = `/${name}`;
    const db = new pg.Client({ connectionString: url.toString() });
    await db.connect();
    try {
      await applyMigrations(db, (m) => m < "20261128090000_add_public_id_categories");
      await db.query(`insert into businesses(name) values ('A'),('B')`);
      await db.query(`insert into categories(business_id,name) values (1,'Phones'),(1,'Cases'),(2,'Phones')`);
      const before = (await db.query(`select id,business_id,name from categories order by id`)).rows;
      await applyMigrations(db, (m) => m === "20261128090000_add_public_id_categories");
      const after = (await db.query(`select id,business_id,name,public_id from categories order by id`)).rows;
      expect(after.length).toBe(3);
      expect(after.map(({ public_id, ...r }) => r)).toEqual(before);
      const ids = after.map((r) => r.public_id as string);
      for (const id of ids) expect(id).toMatch(UUID);
      expect(new Set(ids).size).toBe(3);
      await expect(db.query(`update categories set public_id = $1 where id = 2`, [ids[0]])).rejects.toThrow(/duplicate key/);
      await expect(db.query(`update categories set public_id = null where id = 1`)).rejects.toThrow(/not-null|null value/);
    } finally {
      await db.end();
      await admin.query(`drop database if exists "${name}" with (force)`);
      await admin.end();
    }
  }, 60_000);
});

describe("customers and suppliers use random public ids everywhere they appear", () => {
  let a: Tenant;
  let b: Tenant;
  beforeAll(async () => { await resetData(); a = await registerTenant("Pub C A"); b = await registerTenant("Pub C B"); });
  const internalId = async (table: "customers" | "suppliers", publicId: string) =>
    String((await query(`select id from ${table} where public_id = $1::uuid`, [publicId]))[0]!.id);

  it("customer: random id on its own routes and on every record that points at it", async () => {
    const cust = (await post("/customers", a, { name: "Wanjiku" })).body.data;
    expect(cust.id).toMatch(UUID);
    expect(cust.id).not.toBe(await internalId("customers", cust.id));
    for (const c of (await get("/customers", a)).body.data) expect(c.id).toMatch(UUID);

    const prod = (await post("/products", a, { name: "Cust Item", costPrice: 10, sellingPrice: 50, stockQuantity: 20 })).body.data;
    const sale = await post("/sales", a, { customerId: cust.id, amountPaid: 20, paymentMethod: "cash", items: [{ productId: prod.id, quantity: 2, unitPrice: 50 }] });
    expect(sale.status, JSON.stringify(sale.body)).toBe(201);
    expect(sale.body.data.customerId).toBe(cust.id);
    expect(sale.body.data.customerName).toBe("Wanjiku");
    const saleId = sale.body.data.id;
    expect((await get(`/sales/${saleId}`, a)).body.data.customerId).toBe(cust.id);
    expect((await get("/sales", a)).body.data.find((s: any) => s.id === saleId).customerId).toBe(cust.id);

    // edit keeps/changes the customer by public id
    const other = (await post("/customers", a, { name: "Otieno" })).body.data;
    const edited = await put(`/sales/${saleId}`, a, { customerId: other.id, items: [{ productId: prod.id, quantity: 2, unitPrice: 50 }] });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    expect(edited.body.data.customerId).toBe(other.id);

    // quotation + invoice + payments list
    const quote = await post("/quotations", a, { customerId: cust.id, items: [{ productId: prod.id, quantity: 1, unitPrice: 50 }] });
    expect(quote.status, JSON.stringify(quote.body)).toBe(201);
    expect(quote.body.data.customerId).toBe(cust.id);
    expect(quote.body.data.customer.id).toBe(cust.id);
    const inv = await post("/invoices", a, { saleId });
    expect(inv.status, JSON.stringify(inv.body)).toBe(201);
    expect(inv.body.data.customerId).toBe(other.id);
    expect(inv.body.data.customer.id).toBe(other.id);
    const pays = await get("/payments", a);
    expect(pays.body.data.find((p: any) => p.saleId === saleId).customerId).toBe(other.id);

    // debt: receive payment + unpaid sales + report
    expect((await get(`/customers/${other.id}/unpaid-sales`, a)).body.data.customer.id).toBe(other.id);
    const rec = await post(`/customers/${other.id}/payments`, a, { amount: 10, method: "cash" });
    expect(rec.status, JSON.stringify(rec.body)).toBe(201);
    expect(rec.body.data.customer.id).toBe(other.id);
    const rep = await get("/reports?startDate=2026-01-01&endDate=2026-12-31", a);
    expect(rep.body.data.debts.customers.find((c: any) => c.customerName === "Otieno").customerId).toBe(other.id);
  });

  it("customer: numeric ids and other businesses' ids are refused everywhere", async () => {
    const mine = (await post("/customers", a, { name: "Mine" })).body.data;
    const theirs = (await post("/customers", b, { name: "Theirs" })).body.data;
    const numeric = await internalId("customers", mine.id);
    const prod = (await post("/products", a, { name: "Guard Item", costPrice: 1, sellingPrice: 5, stockQuantity: 5 })).body.data;
    const sale = { amountPaid: 5, paymentMethod: "cash", items: [{ productId: prod.id, quantity: 1, unitPrice: 5 }] };
    expect((await put(`/customers/${numeric}`, a, { name: "X" })).status).toBe(400);
    expect((await del(`/customers/${numeric}`, a)).status).toBe(400);
    expect((await get(`/customers/${numeric}/unpaid-sales`, a)).status).toBe(400);
    expect((await post(`/customers/${numeric}/payments`, a, { amount: 1, method: "cash" })).status).toBe(400);
    expect((await post("/sales", a, { ...sale, customerId: numeric })).status).toBe(400);
    expect((await post("/sales", a, { ...sale, customerId: theirs.id })).status).toBe(404);
    expect((await post("/quotations", a, { customerId: numeric, items: [{ productId: prod.id, quantity: 1, unitPrice: 5 }] })).status).toBe(400);
    expect((await put(`/customers/${theirs.id}`, a, { name: "Taken" })).status).toBe(404);
    expect((await get("/customers", b)).body.data.find((c: any) => c.id === theirs.id).name).toBe("Theirs");
  });

  it("supplier: random id on its own routes and on purchases, payments and the report", async () => {
    const sup = (await post("/suppliers", a, { name: "Bidco" })).body.data;
    expect(sup.id).toMatch(UUID);
    expect(sup.id).not.toBe(await internalId("suppliers", sup.id));
    for (const s of (await get("/suppliers", a)).body.data) expect(s.id).toMatch(UUID);
    const prod = (await post("/products", a, { name: "Sup Item", costPrice: 10, sellingPrice: 50, stockQuantity: 0 })).body.data;
    const buy = await post("/purchases", a, { supplierId: sup.id, amountPaid: 0, items: [{ productId: prod.id, quantity: 5, unitCost: 10 }] });
    expect(buy.status, JSON.stringify(buy.body)).toBe(201);
    expect(buy.body.data.supplierId).toBe(sup.id);
    const pid = buy.body.data.id;
    expect((await get(`/purchases/${pid}`, a)).body.data.supplierId).toBe(sup.id);
    expect((await get("/purchases", a)).body.data.find((p: any) => p.id === pid).supplierId).toBe(sup.id);
    const pay = await post(`/purchases/${pid}/payments`, a, { amount: 10, method: "cash" });
    expect(pay.status, JSON.stringify(pay.body)).toBe(201);
    expect(pay.body.data.supplierId).toBe(sup.id);
    const rep = await get("/reports?startDate=2026-01-01&endDate=2026-12-31", a);
    expect(rep.body.data.purchaseBreakdown.find((s: any) => s.supplierName === "Bidco").supplierId).toBe(sup.id);
  });

  it("supplier: numeric ids and other businesses' ids are refused", async () => {
    const mine = (await post("/suppliers", a, { name: "MineS" })).body.data;
    const theirs = (await post("/suppliers", b, { name: "TheirsS" })).body.data;
    const numeric = await internalId("suppliers", mine.id);
    const prod = (await post("/products", a, { name: "Guard Sup", costPrice: 1, sellingPrice: 5, stockQuantity: 0 })).body.data;
    const buy = (id: string) => post("/purchases", a, { supplierId: id, amountPaid: 0, items: [{ productId: prod.id, quantity: 1, unitCost: 1 }] });
    expect((await put(`/suppliers/${numeric}`, a, { name: "X" })).status).toBe(400);
    expect((await del(`/suppliers/${numeric}`, a)).status).toBe(400);
    expect((await buy(numeric)).status).toBe(400);
    expect((await buy(theirs.id)).status).toBe(404);
    expect((await put(`/suppliers/${theirs.id}`, a, { name: "Taken" })).status).toBe(404);
    expect((await get("/suppliers", b)).body.data.find((s: any) => s.id === theirs.id).name).toBe("TheirsS");
  });
});

describe("public id migration for customers and suppliers on existing rows", () => {
  it("gives every existing customer and supplier its own random id and keeps every row", async () => {
    const cfg = loadTestConfig();
    const name = `${cfg.dbName}_publicid_cs_upgrade_test`;
    expect(name.endsWith("_test")).toBe(true);
    const admin = new pg.Client({ connectionString: cfg.adminUrl });
    await admin.connect();
    await admin.query(`drop database if exists "${name}" with (force)`);
    await admin.query(`create database "${name}"`);
    const url = new URL(cfg.databaseUrl);
    url.pathname = `/${name}`;
    const db = new pg.Client({ connectionString: url.toString() });
    await db.connect();
    try {
      await applyMigrations(db, (m) => m < "20261129090000_add_public_id_customers_suppliers");
      await db.query(`insert into businesses(name) values ('A'),('B')`);
      await db.query(`insert into customers(business_id,name) values (1,'C1'),(1,'C2'),(2,'C3')`);
      await db.query(`insert into suppliers(business_id,name) values (1,'S1'),(2,'S2')`);
      const before = {
        c: (await db.query(`select id,business_id,name from customers order by id`)).rows,
        s: (await db.query(`select id,business_id,name from suppliers order by id`)).rows,
      };
      await applyMigrations(db, (m) => m === "20261129090000_add_public_id_customers_suppliers");
      const c = (await db.query(`select id,business_id,name,public_id from customers order by id`)).rows;
      const s = (await db.query(`select id,business_id,name,public_id from suppliers order by id`)).rows;
      expect(c.map(({ public_id, ...r }) => r)).toEqual(before.c);
      expect(s.map(({ public_id, ...r }) => r)).toEqual(before.s);
      const ids = [...c, ...s].map((r) => r.public_id as string);
      for (const id of ids) expect(id).toMatch(UUID);
      expect(new Set(ids).size).toBe(5);
      await expect(db.query(`update customers set public_id = $1 where id = 2`, [c[0].public_id])).rejects.toThrow(/duplicate key/);
      await expect(db.query(`update suppliers set public_id = null where id = 1`)).rejects.toThrow(/null value|not-null/);
    } finally {
      await db.end();
      await admin.query(`drop database if exists "${name}" with (force)`);
      await admin.end();
    }
  }, 60_000);
});
