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
