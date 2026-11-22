import { describe, it, expect, beforeAll } from "vitest";
import pg from "pg";
import { applyMigrations, query, resetData } from "../support/db.js";
import { loadTestConfig } from "../support/env.js";
import { api, get, post, put } from "../support/http.js";
import { registerTenant, createProduct, addEmployee, type Tenant } from "../support/seed.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const RANDOM = "3f2b1c1e-9d4a-4c55-8a1e-0b9f6d7e1a42";
const inBranch = (t: Tenant, branch: string, path: string) => api("GET", path, { session: t, headers: { "x-branch-id": branch } });

describe("branches, roles and stock transfers use random public ids", () => {
  let a: Tenant;
  let b: Tenant;
  beforeAll(async () => { await resetData(); a = await registerTenant("Pub BR A"); b = await registerTenant("Pub BR B"); });

  it("shows a UUID on branches, transfers, roles and employees", async () => {
    const branches = (await get("/branches", a)).body.data as { id: string; isMain: boolean }[];
    expect(branches[0]!.id).toMatch(UUID);
    const main = branches.find((x) => x.isMain)!.id;
    const second = await post("/branches", a, { name: "Westlands" });
    expect(second.status, JSON.stringify(second.body)).toBe(201);
    expect(second.body.data.id).toMatch(UUID);
    const p = await createProduct(a, { name: "Tea 500g", costPrice: 50, sellingPrice: 80, stockQuantity: 40 });
    const t = await post("/branches/transfers", a, { fromBranchId: main, toBranchId: second.body.data.id, items: [{ productId: p.id, quantity: 5 }] });
    expect(t.status, JSON.stringify(t.body)).toBe(201);
    for (const k of ["id", "fromBranchId", "toBranchId"]) expect(t.body.data[k]).toMatch(UUID);
    expect(((await get("/branches/transfers", a)).body.data[0]).id).toMatch(UUID);
    for (const r of (await get("/branches/stock", a)).body.data) expect(r.branchId).toMatch(UUID);

    const roles = (await get("/roles", a)).body.data as { id: string }[];
    for (const r of roles) expect(r.id).toMatch(UUID);
    const emp = await addEmployee(a, "Cashier");
    const staff = (await get("/employees", a)).body.data as { role: { id: string }; branchId: string | null }[];
    for (const e of staff) expect(e.role.id).toMatch(UUID);
    const assigned = await api("PUT", `/branches/staff/${emp.userPublicId}`, { session: a, body: { branchId: second.body.data.id } });
    expect(assigned.status, JSON.stringify(assigned.body)).toBe(200);
    expect(assigned.body.data.branchId).toBe(second.body.data.id);
    expect(((await get("/employees", a)).body.data as { branchId: string | null }[]).some((e) => e.branchId === second.body.data.id)).toBe(true);
  });

  it("works in a branch by UUID, refuses unknown or foreign ones, and still honours an old numeric header", async () => {
    const mine = (await get("/branches", a)).body.data[0].id as string;
    const theirs = (await get("/branches", b)).body.data[0].id as string;
    expect((await inBranch(a, mine, "/branches/stock?current=1")).status).toBe(200);
    expect((await inBranch(a, RANDOM, "/branches/stock?current=1")).status).toBe(403);
    expect((await inBranch(a, theirs, "/branches/stock?current=1")).status).toBe(403);
    // a number saved by a till (or queued with an offline sale) before this change keeps working, scoped to this business
    const [{ id: internalMine }] = await query<{ id: string }>(`select id::text as id from branches where public_id = $1::uuid`, [mine]);
    expect((await inBranch(a, internalMine, "/branches/stock?current=1")).status).toBe(200);
    const [{ id: internalTheirs }] = await query<{ id: string }>(`select id::text as id from branches where public_id = $1::uuid`, [theirs]);
    expect((await inBranch(a, internalTheirs, "/branches/stock?current=1")).status).toBe(403);
  });

  it("refuses numeric and junk ids on branch, role, transfer and report inputs", async () => {
    const mine = (await get("/branches", a)).body.data[0].id as string;
    const [{ id: n }] = await query<{ id: string }>(`select id::text as id from branches where public_id = $1::uuid`, [mine]);
    expect((await api("PUT", `/branches/${n}`, { session: a, body: { name: "X" } })).status).toBe(400);
    expect((await api("PUT", `/branches/${RANDOM}`, { session: a, body: { name: "X" } })).status).toBe(404);
    expect((await api("PUT", `/branches/${mine}`, { session: b, body: { name: "Hijack" } })).status).toBe(404);
    const p = await createProduct(a, { name: "Jam 400g", costPrice: 10, sellingPrice: 20, stockQuantity: 10 });
    expect((await post("/branches/transfers", a, { fromBranchId: n, toBranchId: mine, items: [{ productId: p.id, quantity: 1 }] })).status).toBe(400);
    expect((await get(`/reports?startDate=2020-01-01&endDate=2030-12-31&branchId=${n}`, a)).status).toBe(400);
    expect((await get(`/reports?startDate=2020-01-01&endDate=2030-12-31&branchId=${RANDOM}`, a)).status).toBe(404);
    expect((await get(`/reports?startDate=2020-01-01&endDate=2030-12-31&branchId=${mine}`, a)).status).toBe(200);
    const role = ((await get("/roles", a)).body.data as { id: string; name: string }[]).find((r) => r.name === "Cashier")!;
    const [{ id: rn }] = await query<{ id: string }>(`select id::text as id from roles where public_id = $1::uuid`, [role.id]);
    expect((await put(`/roles/${rn}`, a, { permissions: ["products.view"] })).status).toBe(400);
    expect((await put(`/roles/${role.id}`, b, { permissions: ["products.view"] })).status).toBe(404);
    expect((await post("/employees", a, { name: "Test Person", email: "tp-roles@example.com", phone: "0712345678", password: "Strong-Pass-123", roleId: rn })).status).toBe(400);
    expect((await query(`select name from branches where public_id = $1::uuid`, [mine]))[0]!.name).not.toBe("Hijack");
  });
});

describe("public id migration for branches, roles and transfers on existing rows", () => {
  it("gives every existing row its own random id and keeps every row", async () => {
    const cfg = loadTestConfig();
    const name = `${cfg.dbName}_publicid_brt_test`;
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
      await applyMigrations(db, (m) => m < "20261207090000_add_public_id_branches_roles_transfers");
      await db.query(`insert into businesses(name) values ('A'),('B')`);
      await db.query(`insert into roles(business_id,name,permissions) values (1,'Extra1','{}'),(2,'Extra2','{}')`);
      const main = (await db.query(`select id from branches where business_id = 1 and is_main`)).rows[0].id;
      await db.query(`insert into branches(business_id,name) values (1,'Second')`);
      const second = (await db.query(`select id from branches where name = 'Second'`)).rows[0].id;
      await db.query(`insert into stock_transfers(business_id,from_branch_id,to_branch_id) values (1,${main},${second}),(1,${second},${main})`);
      const counts = async () => (await db.query(`select (select count(*)::int from branches) b, (select count(*)::int from roles) r, (select count(*)::int from stock_transfers) t`)).rows[0];
      const before = await counts();
      await applyMigrations(db, (m) => m === "20261207090000_add_public_id_branches_roles_transfers");
      expect(await counts()).toEqual(before);
      for (const t of ["branches", "roles", "stock_transfers"]) {
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
