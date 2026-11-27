import { describe, it, expect, beforeAll } from "vitest";
import { query, resetData } from "../support/db.js";
import { get, post } from "../support/http.js";
import { addEmployee, registerTenant, type Tenant } from "../support/seed.js";

describe("employee sign-in links", () => {
  let owner: Tenant, other: Tenant;
  let n = 0;
  const mk = (t: Tenant = owner, extra: object = {}) => post("/employees/invites", t, { name: "Wanjiru Mwangi", email: `staff-${++n}-${Date.now()}@shop.example`, roleName: "cashier", ...extra });
  const accept = (token: string, pin: string, password = "my-own-password-1") => post("/auth/staff-invite/accept", undefined, { token, pin, password });

  beforeAll(async () => {
    await resetData();
    owner = await registerTenant("Staff Link Shop");
    other = await registerTenant("Other Staff Shop");
  }, 60_000);

  it("creates a link and PIN once, stores only hashes, and the employee sets their own password", async () => {
    const r = await mk();
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const { token, pin, email } = r.body.data;
    expect(token.length).toBeGreaterThan(30);
    expect(pin).toMatch(/^\d{6}$/);
    const raw = await query<{ token_hash: string; pin_hash: string }>(`select token_hash, pin_hash from employee_invites order by id desc limit 1`);
    expect(raw[0]!.token_hash).not.toBe(token);
    expect(JSON.stringify(raw)).not.toContain(pin + '"');
    const info = await get(`/auth/staff-invite/${token}`, undefined);
    expect(info.status).toBe(200);
    expect(info.body.data).toMatchObject({ email, name: "Wanjiru Mwangi", businessName: "Staff Link Shop" });
    const a = await accept(token, pin);
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    const login = await post("/auth/login", undefined, { email, password: "my-own-password-1" });
    expect(login.status, JSON.stringify(login.body)).toBe(200);
    const list = (await get("/employees", owner)).body.data as any[];
    const me = list.find((e) => e.email === email);
    expect(me.role.name.toLowerCase()).toBe("cashier");
    expect(me.isActive).toBe(true);
  });

  it("works once only, then the link is dead", async () => {
    const r = await mk();
    const { token, pin } = r.body.data;
    expect((await accept(token, pin)).status).toBe(201);
    expect((await accept(token, pin)).status).toBe(403);
    expect((await get(`/auth/staff-invite/${token}`, undefined)).status).toBe(404);
  });

  it("a wrong PIN is refused, and five wrong PINs burn the link even for the right PIN", async () => {
    const r = await mk();
    const { token, pin } = r.body.data;
    const wrong = pin === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) expect((await accept(token, wrong)).status).toBe(403);
    expect((await accept(token, pin)).status).toBe(403);
    const l = (await get("/employees/invites", owner)).body.data as any[];
    expect(l.find((x) => x.email === r.body.data.email).status).toBe("locked");
  });

  it("rejects weak passwords without using up the link", async () => {
    const r = await mk();
    const { token, pin } = r.body.data;
    expect((await accept(token, pin, "short")).status).toBe(400);
    expect((await accept(token, pin)).status).toBe(201);
  });

  it("a new link replaces the old one for the same person; cancelling kills it", async () => {
    const email = `repl-${Date.now()}@shop.example`;
    const a = await mk(owner, { email });
    const b = await mk(owner, { email });
    expect((await accept(a.body.data.token, a.body.data.pin)).status).toBe(403);
    const c = await post(`/employees/invites/${b.body.data.id}/cancel`, owner, {});
    expect(c.status).toBe(200);
    expect((await accept(b.body.data.token, b.body.data.pin)).status).toBe(403);
    expect((await post(`/employees/invites/${b.body.data.id}/cancel`, owner, {})).status).toBe(409);
  });

  it("an expired link is refused", async () => {
    const r = await mk();
    await query(`update employee_invites set expires_at = now() - interval '1 minute' where id = $1`, [r.body.data.id]);
    expect((await accept(r.body.data.token, r.body.data.pin)).status).toBe(403);
    expect((await get(`/auth/staff-invite/${r.body.data.token}`, undefined)).status).toBe(404);
  });

  it("refuses an email that already has an account, an owner role, and bad input", async () => {
    const taken = await mk(owner, { email: owner.email });
    expect(taken.status).toBe(409);
    expect((await mk(owner, { roleName: "owner" })).status).toBe(400);
    expect((await mk(owner, { email: "not-an-email" })).status).toBe(400);
    expect((await mk(owner, { name: "" })).status).toBe(400);
    expect((await mk(owner, { roleName: "nonexistent-role" })).status).toBe(400);
  });

  it("is limited to people who can manage employees, and each business sees only its own links", async () => {
    const nobody = await addEmployee(owner, "no staff rights", ["sales.create"]);
    expect((await mk(nobody)).status).toBe(403);
    expect((await get("/employees/invites", nobody)).status).toBe(403);
    const mine = await mk();
    const theirs = (await get("/employees/invites", other)).body.data as any[];
    expect(theirs.find((x) => x.id === mine.body.data.id)).toBeUndefined();
    expect((await post(`/employees/invites/${mine.body.data.id}/cancel`, other, {})).status).toBe(404);
  });

  it("garbage links and tokens are refused without detail", async () => {
    expect((await get("/auth/staff-invite/short", undefined)).status).toBe(404);
    expect((await accept("x".repeat(43), "123456")).status).toBe(403);
    expect((await post("/auth/staff-invite/accept", undefined, {})).status).toBe(403);
  });
});
