import { describe, it, expect, beforeAll } from "vitest";
import pg from "pg";
import { applyMigrations, query, resetData } from "../support/db.js";
import { loadTestConfig } from "../support/env.js";
import { api, get } from "../support/http.js";
import { registerTenant, type Tenant } from "../support/seed.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const RANDOM = "3f2b1c1e-9d4a-4c55-8a1e-0b9f6d7e1a42";
const withBusiness = (t: Tenant, id: string, path = "/products") => api("GET", path, { session: { token: t.token, businessId: id } as never });

describe("businesses use random public ids", () => {
  let a: Tenant;
  let b: Tenant;
  beforeAll(async () => { await resetData(); a = await registerTenant("Pub BZ A"); b = await registerTenant("Pub BZ B"); });

  it("shows a UUID on sign-in, registration, the business list and current business", async () => {
    expect(a.businessPublicId).toMatch(UUID);
    const login = await api("POST", "/auth/login", { body: { email: a.email, password: a.password }, headers: { "x-auth-mode": "bearer" } });
    expect(login.status, JSON.stringify(login.body)).toBe(200);
    expect(login.body.data.businesses[0].id).toBe(a.businessPublicId);
    const list = (await get("/businesses", a)).body.data as { id: string }[];
    expect(list[0]!.id).toBe(a.businessPublicId);
    const current = (await get("/businesses/current", a)).body.data;
    expect(current.id).toBe(a.businessPublicId);
    expect(JSON.stringify(current)).not.toContain(`"id":"${a.businessId}"`);
  });

  it("selects the business by UUID, refuses unknown or foreign ones, and still honours an old numeric header", async () => {
    expect((await withBusiness(a, a.businessPublicId)).status).toBe(200);
    expect((await withBusiness(a, RANDOM)).status).toBe(403);
    expect((await withBusiness(a, b.businessPublicId)).status).toBe(403); // someone else's business
    expect((await withBusiness(a, "abc")).status).toBe(400);
    expect((await withBusiness(a, "1' or '1'='1")).status).toBe(400);
    // a number saved by a tab or queued offline sale before this change keeps working, but only for a business you belong to
    expect((await withBusiness(a, a.businessId)).status).toBe(200);
    expect((await withBusiness(a, b.businessId)).status).toBe(403);
  });

  it("business settings are read and written through the UUID-selected business", async () => {
    const before = (await get("/businesses/current", a)).body.data;
    const upd = await api("PUT", "/businesses/current", { session: a, body: { name: before.name, phone: "0712345678" } });
    expect(upd.status, JSON.stringify(upd.body)).toBe(200);
    expect(upd.body.data.id).toBe(a.businessPublicId);
    expect((await query(`select phone from businesses where public_id = $1::uuid`, [a.businessPublicId]))[0]!.phone).toBe("0712345678");
    expect((await query(`select phone from businesses where public_id = $1::uuid`, [b.businessPublicId]))[0]!.phone).not.toBe("0712345678");
  });
});

describe("public id migration for businesses on existing rows", () => {
  it("gives every existing business its own random id and keeps every row", async () => {
    const cfg = loadTestConfig();
    const name = `${cfg.dbName}_publicid_biz_test`;
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
      await applyMigrations(db, (m) => m < "20261209090000_add_public_id_businesses");
      await db.query(`insert into businesses(name) values ('A'),('B'),('C')`);
      const before = (await db.query(`select id, name from businesses order by id`)).rows;
      await applyMigrations(db, (m) => m === "20261209090000_add_public_id_businesses");
      const after = (await db.query(`select id, name, public_id::text as pid from businesses order by id`)).rows;
      expect(after.map(({ pid, ...r }) => r)).toEqual(before);
      const ids = after.map((r) => r.pid as string);
      for (const id of ids) expect(id).toMatch(UUID);
      expect(new Set(ids).size).toBe(3);
    } finally {
      await db.end();
      await admin.query(`drop database if exists "${name}" with (force)`);
      await admin.end();
    }
  }, 60_000);
});
