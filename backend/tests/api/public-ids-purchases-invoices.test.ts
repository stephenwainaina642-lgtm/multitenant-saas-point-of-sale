import { describe, it, expect, beforeAll } from "vitest";
import pg from "pg";
import { applyMigrations, query, resetData } from "../support/db.js";
import { loadTestConfig } from "../support/env.js";
import { get, post } from "../support/http.js";
import { registerTenant, createProduct, createCustomer, type Tenant } from "../support/seed.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const RANDOM = "3f2b1c1e-9d4a-4c55-8a1e-0b9f6d7e1a42";

describe("purchases, invoices and payments use random public ids", () => {
  let a: Tenant;
  let b: Tenant;
  beforeAll(async () => { await resetData(); a = await registerTenant("Pub PI A"); b = await registerTenant("Pub PI B"); });

  it("shows a random id on purchases, supplier payments, invoices and customer payments", async () => {
    const p = await createProduct(a, { name: "Sugar 1kg", costPrice: 100, sellingPrice: 200, stockQuantity: 100 });
    const sup = (await post("/suppliers", a, { name: "Mombasa Wholesale" })).body.data;
    const buy = await post("/purchases", a, { supplierId: sup.id, amountPaid: 100, paymentMethod: "cash", items: [{ productId: p.id, quantity: 5, unitCost: 100 }] });
    expect(buy.status, JSON.stringify(buy.body)).toBe(201);
    expect(buy.body.data.id).toMatch(UUID);
    const pay = await post(`/purchases/${buy.body.data.id}/payments`, a, { amount: 50, method: "cash" });
    expect(pay.status, JSON.stringify(pay.body)).toBeLessThan(300);
    const detail = (await get(`/purchases/${buy.body.data.id}`, a)).body.data;
    expect(detail.id).toBe(buy.body.data.id);
    for (const x of detail.payments) expect(x.id).toMatch(UUID);
    const list = (await get("/purchases", a)).body.data;
    expect(list[0].id).toMatch(UUID);

    const c = await createCustomer(a, "Akinyi Credit", "0712000333");
    const sale = (await post("/sales", a, { customerId: c.id, amountPaid: 100, paymentMethod: "cash", items: [{ productId: p.id, quantity: 2, unitPrice: 200 }] })).body.data;
    const cp = await post("/payments", a, { saleId: sale.id, amount: 20, method: "cash" });
    expect(cp.status, JSON.stringify(cp.body)).toBe(201);
    expect(cp.body.data.payment.id).toMatch(UUID);
    const inv = await post("/invoices", a, { saleId: sale.id });
    expect(inv.status, JSON.stringify(inv.body)).toBe(201);
    expect(inv.body.data.id).toMatch(UUID);
    expect((await get(`/invoices/${inv.body.data.id}`, a)).body.data.id).toBe(inv.body.data.id);
    for (const row of (await get("/payments", a)).body.data) expect(row.id).toMatch(UUID);

    // no response carries the internal numeric id of these rows
    const internal = (table: string, pid: string) => query(`select id from ${table} where public_id = $1::uuid`, [pid]).then((r) => String(r[0]!.id));
    const text = JSON.stringify([buy.body, detail, list, cp.body, inv.body, (await get("/invoices", a)).body, (await get("/payments", a)).body]);
    for (const [table, pid] of [["purchases", buy.body.data.id], ["invoices", inv.body.data.id], ["payments", cp.body.data.payment.id]] as const) {
      const n = await internal(table, pid);
      expect(text).not.toMatch(new RegExp(`"id":"?${n}"?,"(supplierId|invoiceNumber|saleId|amount)"`));
    }
  });

  it("refuses numeric and junk ids and other businesses' rows", async () => {
    const p = await createProduct(a, { name: "Salt 1kg", costPrice: 10, sellingPrice: 20, stockQuantity: 50 });
    const sup = (await post("/suppliers", a, { name: "Nakuru Supplies" })).body.data;
    const buy = (await post("/purchases", a, { supplierId: sup.id, amountPaid: 0, items: [{ productId: p.id, quantity: 5, unitCost: 10 }] })).body.data;
    const sale = (await post("/sales", a, { amountPaid: 20, paymentMethod: "cash", items: [{ productId: p.id, quantity: 1, unitPrice: 20 }] })).body.data;
    const inv = (await post("/invoices", a, { saleId: sale.id })).body.data;
    for (const bad of ["1", "abc", "1' or '1'='1"]) {
      const e = encodeURIComponent(bad);
      expect((await get(`/purchases/${e}`, a)).status).toBe(400);
      expect((await post(`/purchases/${e}/payments`, a, { amount: 1, method: "cash" })).status).toBe(400);
      expect((await post(`/purchases/${e}/void`, a, { reason: "x" })).status).toBe(400);
      expect((await get(`/invoices/${e}`, a)).status).toBe(400);
    }
    expect((await get(`/purchases/${RANDOM}`, a)).status).toBe(404);
    expect((await get(`/invoices/${RANDOM}`, a)).status).toBe(404);
    expect((await get(`/purchases/${buy.id}`, b)).status).toBe(404);
    expect((await post(`/purchases/${buy.id}/payments`, b, { amount: 1, method: "cash" })).status).toBe(404);
    expect((await post(`/purchases/${buy.id}/void`, b, { reason: "x" })).status).toBe(404);
    expect((await get(`/invoices/${inv.id}`, b)).status).toBe(404);
    expect((await query(`select status from purchases where public_id = $1::uuid`, [buy.id]))[0]!.status).not.toBe("voided");
  });
});

describe("public id migration for purchases, invoices and payments on existing rows", () => {
  it("gives every existing row its own random id and keeps every row", async () => {
    const cfg = loadTestConfig();
    const name = `${cfg.dbName}_publicid_pip_test`;
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
      await applyMigrations(db, (m) => m < "20261206090000_add_public_id_purchases_invoices_payments");
      await db.query(`insert into businesses(name) values ('A')`);
      const br = (await db.query(`select id from branches where business_id = 1 and is_main`)).rows[0].id;
      await db.query(`insert into suppliers(business_id,name) values (1,'S')`);
      await db.query(`insert into purchases(business_id,branch_id,supplier_id,subtotal,discount,tax,total,amount_paid,balance_due) values (1,${br},1,5,0,0,5,5,0),(1,${br},1,6,0,0,6,6,0)`);
      await db.query(`insert into supplier_payments(business_id,purchase_id,amount,method) values (1,1,1,'cash'),(1,2,2,'cash')`);
      await db.query(`insert into sales(business_id,branch_id,receipt_number,subtotal,discount,tax,total,amount_paid,balance_due) values (1,${br},'R1',1,0,0,1,1,0),(1,${br},'R2',2,0,0,2,2,0)`);
      await db.query(`insert into payments(business_id,sale_id,amount,method) values (1,1,1,'cash'),(1,2,2,'cash')`);
      await db.query(`insert into invoices(business_id,sale_id,invoice_number,subtotal,discount,tax,total,amount_paid,balance_due) values (1,1,'I1',1,0,0,1,1,0),(1,2,'I2',2,0,0,2,2,0)`);
      const counts = async () => (await db.query(`select (select count(*)::int from purchases) p, (select count(*)::int from supplier_payments) sp, (select count(*)::int from payments) c, (select count(*)::int from invoices) i`)).rows[0];
      const before = await counts();
      await applyMigrations(db, (m) => m === "20261206090000_add_public_id_purchases_invoices_payments");
      expect(await counts()).toEqual(before);
      for (const t of ["purchases", "supplier_payments", "payments", "invoices"]) {
        const ids = (await db.query(`select public_id::text as id from ${t}`)).rows.map((r) => r.id as string);
        for (const id of ids) expect(id).toMatch(UUID);
        expect(new Set(ids).size).toBe(2);
      }
    } finally {
      await db.end();
      await admin.query(`drop database if exists "${name}" with (force)`);
      await admin.end();
    }
  }, 60_000);
});
