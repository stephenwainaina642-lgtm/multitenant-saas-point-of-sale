import { describe, it, expect, beforeAll } from "vitest";
import pg from "pg";
import { applyMigrations, query, resetData } from "../support/db.js";
import { loadTestConfig } from "../support/env.js";
import { api, get, post } from "../support/http.js";
import { registerTenant, createProduct, createCustomer, type Tenant } from "../support/seed.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const RANDOM = "3f2b1c1e-9d4a-4c55-8a1e-0b9f6d7e1a42";
type Log = { id: string; businessId: string; userId: string | null; entity: string; entityId: string | null; action: string; details: Record<string, unknown> | null; user: { id: string } | null };
const logs = async (t: Tenant, qs = "") => (await get(`/audit-logs?limit=200${qs}`, t)).body.data as Log[];

describe("audit log shows public ids and filters by them", () => {
  let a: Tenant;
  let b: Tenant;
  let saleId: string;
  let expenseId: string;
  beforeAll(async () => {
    await resetData(); a = await registerTenant("Pub AU A"); b = await registerTenant("Pub AU B");
    const p = await createProduct(a, { name: "Oil 1L", costPrice: 100, sellingPrice: 200, stockQuantity: 100 });
    const c = await createCustomer(a, "Audit Customer", "0712000444");
    const s = await post("/sales", a, { customerId: c.id, amountPaid: 200, paymentMethod: "cash", items: [{ productId: p.id, quantity: 1, unitPrice: 200 }] });
    saleId = s.body.data.id;
    const inv = await post("/invoices", a, { saleId });
    expect(inv.status, JSON.stringify(inv.body)).toBe(201);
    const e = await post("/expenses", a, { category: "Rent", amount: 500, method: "cash", expenseDate: new Date().toISOString() });
    expect(e.status, JSON.stringify(e.body)).toBeLessThan(300);
    expenseId = e.body.data.id;
    const branch = await post("/branches", a, { name: "Audit Branch" });
    expect(branch.status).toBe(201);
  });

  it("every row, user, business and entity id is a UUID; stored history is not rewritten", async () => {
    const rows = await logs(a);
    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const r of rows) {
      expect(r.id).toMatch(UUID);
      expect(r.businessId).toBe(a.businessPublicId);
      if (r.userId) { expect(r.userId).toBe(a.userPublicId); expect(r.user!.id).toBe(a.userPublicId); }
      if (r.entityId) expect(r.entityId).toMatch(UUID);
    }
    const invoiceRow = rows.find((r) => r.action.startsWith("invoice"))!;
    expect(invoiceRow.details!.saleId).toBe(saleId);
    // the database still holds the original numeric ids
    const [stored] = await query<{ entity_id: string }>(`select entity_id::text from audit_logs where entity = 'invoice' and business_id = $1 limit 1`, [a.businessId]);
    expect(stored!.entity_id).toMatch(/^\d+$/);
  });

  it("filters by public entity id and user id; refuses numbers and other businesses'", async () => {
    const forExpense = await logs(a, `&entity=expense&entityId=${expenseId}`);
    expect(forExpense.length).toBeGreaterThan(0);
    for (const r of forExpense) expect(r.entityId).toBe(expenseId);
    expect((await logs(a, `&userId=${a.userPublicId}`)).length).toBeGreaterThan(0);
    expect((await logs(a, `&entity=expense&entityId=${RANDOM}`))).toHaveLength(0);
    expect((await logs(b, `&entity=expense&entityId=${expenseId}`))).toHaveLength(0); // someone else's record
    expect((await logs(b, `&userId=${a.userPublicId}`))).toHaveLength(0);
    for (const qs of ["&userId=1", `&userId=${a.userId}`, "&entity=expense&entityId=1", "&entity=expense&entityId=abc"]) {
      expect((await get(`/audit-logs?limit=5${qs}`, a)).status, qs).toBe(400);
    }
    expect((await get(`/audit-logs?limit=5&entityId=${expenseId}`, a)).status).toBe(400); // entity is needed to know which table
  });

  it("a deleted record's id can no longer be resolved, so it shows as null", async () => {
    const del = await api("DELETE", `/expenses/${expenseId}`, { session: a, body: { reason: "Entered twice by mistake" } });
    expect(del.status, JSON.stringify(del.body)).toBeLessThan(300);
    const rows = (await logs(a)).filter((r) => r.entity === "expense");
    expect(rows.length).toBeGreaterThan(1);
    for (const r of rows) expect(r.entityId).toBeNull();
  });
});

describe("shifts use random public ids", () => {
  let a: Tenant;
  let b: Tenant;
  beforeAll(async () => { await resetData(); a = await registerTenant("Pub SH A"); b = await registerTenant("Pub SH B"); });

  it("shows a UUID for the shift and who opened it; refuses numbers and other businesses'", async () => {
    const open = await post("/shifts/open", a, { openingFloat: 1000 });
    expect(open.status, JSON.stringify(open.body)).toBe(201);
    const id = open.body.data.id as string;
    expect(id).toMatch(UUID);
    expect(open.body.data.openedBy).toBe(a.userPublicId);
    expect((await get(`/shifts/${id}`, a)).status).toBe(200);
    expect(((await get("/shifts", a)).body.data[0]).openedBy).toBe(a.userPublicId);
    expect((await get(`/shifts?userId=${a.userPublicId}`, a)).status).toBe(200);
    const [{ id: n }] = await query<{ id: string }>(`select id::text as id from register_shifts where public_id = $1::uuid`, [id]);
    for (const bad of [n, "abc"]) expect((await get(`/shifts/${bad}`, a)).status).toBe(400);
    expect((await get(`/shifts/${RANDOM}`, a)).status).toBe(404);
    expect((await get(`/shifts/${id}`, b)).status).toBe(404);
    expect((await post(`/shifts/${id}/close`, b, { countedCash: 1000 })).status).toBe(404);
    const closed = await post(`/shifts/${id}/close`, a, { countedCash: 1000 });
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);
    expect(closed.body.data.id).toBe(id);
  });
});

describe("public id migration for audit rows and shifts on existing rows", () => {
  it("gives every existing row its own random id and keeps every row", async () => {
    const cfg = loadTestConfig();
    const name = `${cfg.dbName}_publicid_audit_test`;
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
      await applyMigrations(db, (m) => m < "20261210090000_add_public_id_audit_logs");
      await db.query(`insert into businesses(name) values ('A')`);
      await db.query(`insert into audit_logs(business_id,action,entity,entity_id) values (1,'x','sale',5),(1,'y','sale',6)`);
      const before = (await db.query(`select id, entity_id from audit_logs order by id`)).rows;
      await applyMigrations(db, (m) => m === "20261210090000_add_public_id_audit_logs");
      const after = (await db.query(`select id, entity_id, public_id::text as pid from audit_logs order by id`)).rows;
      expect(after.map(({ pid, ...r }) => r)).toEqual(before); // the stored history is byte-for-byte unchanged
      const ids = after.map((r) => r.pid as string);
      for (const id of ids) expect(id).toMatch(UUID);
      expect(new Set(ids).size).toBe(2);
      expect((await db.query(`select count(*)::int as n from information_schema.columns where table_name = 'register_shifts' and column_name = 'public_id'`)).rows[0].n).toBe(1);
    } finally {
      await db.end();
      await admin.query(`drop database if exists "${name}" with (force)`);
      await admin.end();
    }
  }, 60_000);
});
