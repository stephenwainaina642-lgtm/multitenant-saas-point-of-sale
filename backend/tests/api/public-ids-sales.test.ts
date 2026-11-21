import { describe, it, expect, beforeAll } from "vitest";
import pg from "pg";
import { applyMigrations, query, resetData } from "../support/db.js";
import { loadTestConfig } from "../support/env.js";
import { get, post, put } from "../support/http.js";
import { registerTenant, createProduct, createCustomer, type Tenant } from "../support/seed.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const internalSaleId = async (publicId: string) => String((await query(`select id from sales where public_id = $1::uuid`, [publicId]))[0]!.id);

describe("sales use random public ids everywhere they appear", () => {
  let a: Tenant;
  let b: Tenant;
  beforeAll(async () => { await resetData(); a = await registerTenant("Sale Pub A"); b = await registerTenant("Sale Pub B"); });

  it("shows a random id on sales and on every record that points at a sale", async () => {
    const p = await createProduct(a, { name: "Rice 2kg", costPrice: 100, sellingPrice: 200, stockQuantity: 100 });
    const c = await createCustomer(a, "Wanjiku Credit", "0712000111");
    const sale = await post("/sales", a, { customerId: c.id, amountPaid: 100, paymentMethod: "cash", items: [{ productId: p.id, quantity: 3, unitPrice: 200 }] });
    expect(sale.status, JSON.stringify(sale.body)).toBe(201);
    const id: string = sale.body.data.id;
    expect(id).toMatch(UUID);
    const internal = await internalSaleId(id);

    const pay = await post("/payments", a, { saleId: id, amount: 50, method: "cash" });
    expect(pay.status, JSON.stringify(pay.body)).toBe(201);
    const inv = await post("/invoices", a, { saleId: id });
    expect(inv.status, JSON.stringify(inv.body)).toBe(201);
    const unpaid = (await get(`/customers/${c.id}/unpaid-sales`, a)).body.data;
    expect(unpaid.sales[0].id).toBe(id);
    const settle = await post(`/customers/${c.id}/payments`, a, { amount: 10, method: "cash" });
    expect(settle.status, JSON.stringify(settle.body)).toBeLessThan(300);
    expect(settle.body.data.allocations[0].saleId).toBe(id);

    const q = (await post("/quotations", a, { items: [{ productId: p.id, quantity: 1, unitPrice: 200 }] })).body.data;
    await post(`/quotations/${q.id}/status`, a, { status: "sent" });
    await post(`/quotations/${q.id}/status`, a, { status: "accepted" });
    const conv = await post(`/quotations/${q.id}/convert`, a, { amountPaid: 200, paymentMethod: "cash" });
    expect(conv.status, JSON.stringify(conv.body)).toBeLessThan(300);
    expect(conv.body.data.sale.id).toMatch(UUID);
    expect(conv.body.data.quotation.convertedSaleId).toBe(conv.body.data.sale.id);

    const responses = [
      sale.body, (await get(`/sales/${id}`, a)).body, (await get("/sales", a)).body, pay.body, (await get("/payments", a)).body,
      inv.body, (await get("/invoices", a)).body, unpaid, settle.body, conv.body,
      (await get("/dashboard", a)).body, (await get("/reports/summary", a)).body,
    ];
    const text = JSON.stringify(responses);
    for (const key of ["saleId", "convertedSaleId"]) expect(text).not.toMatch(new RegExp(`"${key}":"?${internal}"?[,}]`));
    expect(text).not.toContain(`"id":"${internal}","receiptNumber"`);
    expect(text).not.toContain(`"id":${internal},"receiptNumber"`);
    expect(text).toContain(id);
  });

  it("refuses the old numeric id and junk wherever a sale is named", async () => {
    const p = await createProduct(a, { name: "Beans 1kg", costPrice: 50, sellingPrice: 100, stockQuantity: 50 });
    const sale = (await post("/sales", a, { amountPaid: 100, paymentMethod: "cash", items: [{ productId: p.id, quantity: 1, unitPrice: 100 }] })).body.data;
    const numeric = await internalSaleId(sale.id);
    for (const bad of [numeric, "abc", "1' or '1'='1"]) {
      const r = await get(`/sales/${encodeURIComponent(bad)}`, a);
      expect(r.status, `GET /sales/${bad}: ${JSON.stringify(r.body)}`).toBe(400);
      expect((await post(`/sales/${bad}/void`, a, { reason: "x" })).status).toBe(400);
      expect((await post("/payments", a, { saleId: bad, amount: 1, method: "cash" })).status).toBe(400);
      expect((await post("/invoices", a, { saleId: bad })).status).toBe(400);
    }
    expect((await get("/sales/3f2b1c1e-9d4a-4c55-8a1e-0b9f6d7e1a42", a)).status).toBe(404);
    expect((await query(`select status from sales where public_id = $1::uuid`, [sale.id]))[0]!.status).toBe("completed");
  });

  it("another business's sale id is refused for reading, paying, invoicing and voiding", async () => {
    const p = await createProduct(a, { name: "Maize 2kg", costPrice: 50, sellingPrice: 100, stockQuantity: 50 });
    const mine = (await post("/sales", a, { amountPaid: 100, paymentMethod: "cash", items: [{ productId: p.id, quantity: 1, unitPrice: 100 }] })).body.data;
    expect((await get(`/sales/${mine.id}`, b)).status).toBe(404);
    expect((await post("/payments", b, { saleId: mine.id, amount: 1, method: "cash" })).status).toBe(404);
    expect((await post("/invoices", b, { saleId: mine.id })).status).toBe(404);
    expect((await post(`/sales/${mine.id}/void`, b, { reason: "x" })).status).toBe(404);
    expect((await query(`select status from sales where public_id = $1::uuid`, [mine.id]))[0]!.status).toBe("completed");
  });

  it("void and edit work through the public id", async () => {
    const p = await createProduct(a, { name: "Flour 2kg", costPrice: 50, sellingPrice: 100, stockQuantity: 50 });
    const cust = await createCustomer(a, "Edit Customer", "0712000222");
    const s = (await post("/sales", a, { customerId: cust.id, amountPaid: 100, paymentMethod: "cash", items: [{ productId: p.id, quantity: 1, unitPrice: 100 }] })).body.data;
    const edit = await put(`/sales/${s.id}`, a, { items: [{ productId: p.id, quantity: 2, unitPrice: 100 }] });
    expect(edit.status, JSON.stringify(edit.body)).toBe(200);
    expect(edit.body.data.id).toBe(s.id);
    const v = await post(`/sales/${s.id}/void`, a, { reason: "Customer returned goods", refundMethod: "cash" });
    expect(v.status, JSON.stringify(v.body)).toBe(200);
    expect(v.body.data.id).toBe(s.id);
  });
});

describe("public id migration for sales on existing rows", () => {
  it("gives every existing sale its own random id and keeps every row", async () => {
    const cfg = loadTestConfig();
    const name = `${cfg.dbName}_publicid_sales_test`;
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
      await applyMigrations(db, (m) => m < "20261205090000_add_public_id_sales");
      await db.query(`insert into businesses(name) values ('A')`);
      const br = (await db.query(`select id from branches where business_id = 1 and is_main`)).rows[0].id;
      await db.query(`insert into sales(business_id,branch_id,receipt_number,subtotal,discount,tax,total,amount_paid,balance_due) values (1,${br},'R1',1,0,0,1,1,0),(1,${br},'R2',2,0,0,2,2,0)`);
      const before = (await db.query(`select id,receipt_number from sales order by id`)).rows;
      await applyMigrations(db, (m) => m === "20261205090000_add_public_id_sales");
      const after = (await db.query(`select id,receipt_number,public_id from sales order by id`)).rows;
      expect(after.map(({ public_id, ...r }) => r)).toEqual(before);
      const ids = after.map((r) => r.public_id as string);
      for (const id of ids) expect(id).toMatch(UUID);
      expect(new Set(ids).size).toBe(2);
    } finally {
      await db.end();
      await admin.query(`drop database if exists "${name}" with (force)`);
      await admin.end();
    }
  }, 60_000);
});
