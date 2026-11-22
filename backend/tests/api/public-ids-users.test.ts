import { describe, it, expect, beforeAll } from "vitest";
import pg from "pg";
import { applyMigrations, query, resetData } from "../support/db.js";
import { loadTestConfig } from "../support/env.js";
import { api, get, post } from "../support/http.js";
import { registerTenant, createProduct, addEmployee, type Tenant } from "../support/seed.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const RANDOM = "3f2b1c1e-9d4a-4c55-8a1e-0b9f6d7e1a42";

describe("users and employee memberships use random public ids", () => {
  let a: Tenant;
  let b: Tenant;
  beforeAll(async () => { await resetData(); a = await registerTenant("Pub US A"); b = await registerTenant("Pub US B"); });

  it("shows a UUID on sign-in, employees, branch staff and salespeople", async () => {
    expect(a.userPublicId).toMatch(UUID);
    const emp = await addEmployee(a, "Cashier");
    const staff = (await get("/employees", a)).body.data as { id: string; userId: string }[];
    expect(staff.length).toBeGreaterThan(1);
    for (const e of staff) { expect(e.id).toMatch(UUID); expect(e.userId).toMatch(UUID); }
    const mine = staff.find((e) => e.userId === emp.userPublicId)!;
    expect(mine).toBeTruthy();
    expect((await get(`/employees/${mine.id}/profile`, a)).status).toBe(200);

    const branches = (await get("/branches", a)).body.data as { id: string }[];
    const assigned = await api("PUT", `/branches/staff/${emp.userPublicId}`, { session: a, body: { branchId: branches[0]!.id } });
    expect(assigned.status, JSON.stringify(assigned.body)).toBe(200);
    expect(assigned.body.data.userId).toBe(emp.userPublicId);

    const p = await createProduct(a, { name: "Soap 1kg", costPrice: 10, sellingPrice: 20, stockQuantity: 10 });
    const sale = await post("/sales", a, { amountPaid: 20, paymentMethod: "cash", items: [{ productId: p.id, quantity: 1, unitPrice: 20 }] });
    expect((await get(`/sales/${sale.body.data.id}`, a)).body.data.salespersonId).toBe(a.userPublicId);
    const dash = (await get("/dashboard", a)).body.data;
    const ids = JSON.stringify(dash);
    expect(ids).toContain(a.userPublicId);
    expect(ids).not.toContain(`"id":"${a.userId}"`);
  });

  it("refuses numeric and junk ids and other businesses' people", async () => {
    const emp = await addEmployee(a, "Manager");
    const staff = (await get("/employees", a)).body.data as { id: string; userId: string }[];
    const mine = staff.find((e) => e.userId === emp.userPublicId)!;
    const [{ id: memberNumber }] = await query<{ id: string }>(`select id::text as id from business_users where public_id = $1::uuid`, [mine.id]);
    expect((await get(`/employees/${memberNumber}/profile`, a)).status).toBe(400);
    expect((await get(`/employees/${RANDOM}/profile`, a)).status).toBe(404);
    expect((await get(`/employees/${mine.id}/profile`, b)).status).toBe(404);
    expect((await post(`/employees/${mine.id}/deactivate`, b, {})).status).toBe(404);
    const branches = (await get("/branches", a)).body.data as { id: string }[];
    expect((await api("PUT", `/branches/staff/${a.userId}`, { session: a, body: { branchId: branches[0]!.id } })).status).toBe(400);
    expect((await api("PUT", `/branches/staff/${RANDOM}`, { session: a, body: { branchId: branches[0]!.id } })).status).toBe(404);
    expect((await api("PUT", `/branches/staff/${emp.userPublicId}`, { session: b, body: { branchId: null } })).status).toBe(404);
    expect((await query(`select is_active from business_users where public_id = $1::uuid`, [mine.id]))[0]!.is_active).toBe(true);
  });

  it("login still works and the sign-in response carries the UUID, not the number", async () => {
    const r = await api("POST", "/auth/login", { body: { email: a.email, password: a.password }, headers: { "x-auth-mode": "bearer" } });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.user.id).toBe(a.userPublicId);
    expect(r.body.data.user.id).not.toBe(a.userId);
  });
});

describe("public id migration for users and memberships on existing rows", () => {
  it("gives every existing row its own random id, keeps every row, and keeps logins' keys", async () => {
    const cfg = loadTestConfig();
    const name = `${cfg.dbName}_publicid_users_test`;
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
      await applyMigrations(db, (m) => m < "20261208090000_add_public_id_users_memberships");
      await db.query(`insert into businesses(name) values ('A')`);
      await db.query(`insert into users(name,email,password_hash) values ('U1','u1@example.com','x'),('U2','u2@example.com','x')`);
      const role = (await db.query(`select id from roles where business_id = 1 limit 1`)).rows[0]?.id
        ?? (await db.query(`insert into roles(business_id,name,permissions) values (1,'R','{}') returning id`)).rows[0].id;
      await db.query(`insert into business_users(business_id,user_id,role_id) values (1,1,${role}),(1,2,${role})`);
      const before = (await db.query(`select id, email from users order by id`)).rows;
      const memBefore = (await db.query(`select id, user_id from business_users order by id`)).rows;
      await applyMigrations(db, (m) => m === "20261208090000_add_public_id_users_memberships");
      const after = (await db.query(`select id, email, public_id::text as pid from users order by id`)).rows;
      expect(after.map(({ pid, ...r }) => r)).toEqual(before);
      expect((await db.query(`select id, user_id from business_users order by id`)).rows).toEqual(memBefore);
      for (const t of ["users", "business_users"]) {
        const ids = (await db.query(`select public_id::text as id from ${t}`)).rows.map((r) => r.id as string);
        for (const id of ids) expect(id).toMatch(UUID);
        expect(new Set(ids).size).toBe(ids.length);
      }
    } finally {
      await db.end();
      await admin.query(`drop database if exists "${name}" with (force)`);
      await admin.end();
    }
  }, 60_000);
});
