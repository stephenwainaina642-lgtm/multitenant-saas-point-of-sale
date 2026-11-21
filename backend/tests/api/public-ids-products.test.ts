import { describe, it, expect, beforeAll } from "vitest";
import pg from "pg";
import { applyMigrations, query, resetData } from "../support/db.js";
import { loadTestConfig } from "../support/env.js";
import { get, post, put } from "../support/http.js";
import { registerTenant, type Tenant } from "../support/seed.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Every `productId` anywhere in a response must be a random id; the response must never carry the internal one. */
function productIdsIn(node: unknown, found: string[] = []): string[] {
  if (Array.isArray(node)) node.forEach((n) => productIdsIn(n, found));
  else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (k === "productId" && typeof v === "string") found.push(v);
      else productIdsIn(v, found);
    }
  }
  return found;
}

describe("products use random public ids everywhere they appear", () => {
  let a: Tenant;
  let b: Tenant;
  beforeAll(async () => { await resetData(); a = await registerTenant("Prod Pub A"); b = await registerTenant("Prod Pub B"); });

  it("shows only random ids on products and on every record that points at them", async () => {
    const p = (await post("/products", a, { name: "Sugar 1kg", costPrice: 100, sellingPrice: 150, stockQuantity: 100, minimumStock: 500 })).body.data;
    expect(p.id).toMatch(UUID);
    const internal = String((await query(`select id from products where public_id = $1::uuid`, [p.id]))[0]!.id);
    expect(p.id).not.toBe(internal);
    for (const x of (await get("/products", a)).body.data) expect(x.id).toMatch(UUID);

    const sale = await post("/sales", a, { amountPaid: 300, paymentMethod: "cash", items: [{ productId: p.id, quantity: 2, unitPrice: 150 }] });
    expect(sale.status, JSON.stringify(sale.body)).toBe(201);
    const saleId = sale.body.data.id;
    const sup = (await post("/suppliers", a, { name: "Supplier One" })).body.data;
    const pur = await post("/purchases", a, { supplierId: sup.id, amountPaid: 0, items: [{ productId: p.id, quantity: 5, unitCost: 100 }] });
    const quote = await post("/quotations", a, { items: [{ productId: p.id, quantity: 1, unitPrice: 150 }] });
    const mv = await post("/inventory", a, { productId: p.id, type: "IN", quantity: 3 });
    expect(mv.status, JSON.stringify(mv.body)).toBe(201);

    const responses: unknown[] = [
      sale.body, (await get(`/sales/${saleId}`, a)).body, (await get("/sales", a)).body,
      pur.body, (await get("/purchases", a)).body, quote.body, (await get("/quotations", a)).body,
      mv.body, (await get("/inventory", a)).body, (await get("/dashboard", a)).body,
      (await get("/reports?startDate=2020-01-01&endDate=2030-12-31", a)).body, (await get("/branches/stock", a)).body,
    ];
    let seen = 0;
    for (const r of responses) {
      for (const id of productIdsIn(r)) { expect(id).toMatch(UUID); seen++; }
    }
    expect(seen).toBeGreaterThan(5);
    const text = JSON.stringify(responses);
    expect(text).not.toContain(`"productId":"${internal}"`);
    expect(text).not.toContain(`"productId":${internal}`);
  });

  it("refuses the old numeric id and junk everywhere a product is named", async () => {
    const p = (await post("/products", a, { name: "Numeric", costPrice: 1, sellingPrice: 2, stockQuantity: 5 })).body.data;
    const numeric = String((await query(`select id from products where public_id = $1::uuid`, [p.id]))[0]!.id);
    expect((await put(`/products/${numeric}`, a, { name: "Hacked" })).status).toBe(400);
    for (const bad of [numeric, "abc", "1' or '1'='1"]) {
      expect((await post("/sales", a, { items: [{ productId: bad, quantity: 1, unitPrice: 2 }] })).status).toBe(400);
      expect((await post("/inventory", a, { productId: bad, type: "IN", quantity: 1 })).status).toBe(400);
      expect((await post("/purchases", a, { supplierId: (await post("/suppliers", a, { name: `Sup ${Math.random()}`.replace(/[^A-Za-z ]/g, "") })).body.data.id, amountPaid: 0, items: [{ productId: bad, quantity: 1, unitCost: 1 }] })).status).toBe(400);
    }
    expect((await query(`select name from products where public_id = $1::uuid`, [p.id]))[0]!.name).toBe("Numeric");
  });

  it("another business's product id is refused for sales, purchases and stock changes", async () => {
    const mine = (await post("/products", a, { name: "Mine Only", costPrice: 1, sellingPrice: 2, stockQuantity: 5 })).body.data;
    expect((await post("/sales", b, { items: [{ productId: mine.id, quantity: 1, unitPrice: 2 }] })).status).toBe(404);
    expect((await post("/purchases", b, { supplierId: (await post("/suppliers", b, { name: "Supplier Two" })).body.data.id, amountPaid: 0, items: [{ productId: mine.id, quantity: 1, unitCost: 1 }] })).status).toBe(404);
    expect((await post("/inventory", b, { productId: mine.id, type: "IN", quantity: 1 })).status).not.toBe(201);
    expect((await put(`/products/${mine.id}`, b, { name: "Stolen" })).status).toBe(404);
    expect(Number((await query(`select stock_quantity from products where public_id = $1::uuid`, [mine.id]))[0]!.stock_quantity)).toBe(5);
  });
});

describe("public id migration for products on existing rows", () => {
  it("gives every existing product its own random id and keeps every row", async () => {
    const cfg = loadTestConfig();
    const name = `${cfg.dbName}_publicid_products_test`;
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
      await applyMigrations(db, (m) => m < "20261203090000_add_public_id_products");
      await db.query(`insert into businesses(name) values ('A'),('B')`);
      await db.query(`insert into products(business_id,name,cost_price,selling_price) values (1,'Sugar',1,2),(1,'Salt',1,2),(2,'Sugar',1,2)`);
      const before = (await db.query(`select id,business_id,name from products order by id`)).rows;
      await applyMigrations(db, (m) => m === "20261203090000_add_public_id_products");
      const after = (await db.query(`select id,business_id,name,public_id from products order by id`)).rows;
      expect(after.map(({ public_id, ...r }) => r)).toEqual(before);
      const ids = after.map((r) => r.public_id as string);
      for (const id of ids) expect(id).toMatch(UUID);
      expect(new Set(ids).size).toBe(3);
      await expect(db.query(`update products set public_id = $1 where id = 2`, [ids[0]])).rejects.toThrow(/duplicate key/);
    } finally {
      await db.end();
      await admin.query(`drop database if exists "${name}" with (force)`);
      await admin.end();
    }
  }, 60_000);
});
