import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { query, resetData } from "../support/db.js";
import { loadTestConfig } from "../support/env.js";
import { startServer, waitForHealth, type RunningServer } from "../support/server.js";
import { encryptSecret, newTotpSecret, stepAt, totpAt } from "../../src/platform/totp.js";

process.env.JWT_SECRET = loadTestConfig().jwtSecret;
const cfg = loadTestConfig();
const PORT = cfg.apiPort + 1;
const BASE = `http://localhost:${PORT}/api`;
const PW = "Platform-Admin-Pass-1";
const H = { "Content-Type": "application/json", "X-Requested-With": "nexapos", Origin: "http://localhost:5173", "X-Auth-Mode": "bearer" };

async function call(method: string, path: string, body?: unknown, extra: Record<string, string> = {}) {
  const res = await fetch(`${BASE}${path}`, { method, headers: { ...H, ...extra }, ...(body !== undefined && { body: JSON.stringify(body) }) });
  return { status: res.status, body: (await res.json()) as any };
}

describe("invite-only sign-up and business approval (open sign-up OFF)", () => {
  let server: RunningServer;
  let admin: Record<string, string>;
  const signup = (email: string, token: string, pin: string, extra: object = {}) =>
    call("POST", "/auth/register", { name: "Client Owner", email, password: "Client-Password-1", businessName: "Client Shop", inviteToken: token, invitePin: pin, ...extra });
  const invite = async (email: string, body: object = {}) => (await call("POST", "/platform/invites", { email, ...body }, admin)).body.data as { id: string; token: string; pin: string };

  beforeAll(async () => {
    await resetData();
    const secret = newTotpSecret();
    await query(`insert into platform_admins(name, email, password_hash, totp_secret_enc) values ('Boss', 'boss@nexa.test', $1, $2)`, [await bcrypt.hash(PW, 4), encryptSecret(secret)]);
    server = startServer(PORT, { OPEN_REGISTRATION: "0" });
    await waitForHealth(`${BASE}/health`, 30_000, server);
    const login = await call("POST", "/platform/login", { email: "boss@nexa.test", password: PW, code: totpAt(secret, stepAt(Date.now())) });
    expect(login.status, JSON.stringify(login.body)).toBe(200);
    admin = { Authorization: `Bearer ${login.body.data.token}` };
  }, 90_000);
  afterAll(async () => { await server?.stop(); });

  it("refuses sign-up without an invitation", async () => {
    expect((await call("GET", "/auth/signup-mode")).body.data.open).toBe(false);
    const r = await call("POST", "/auth/register", { name: "X Y", email: "walkin@example.com", password: "Client-Password-1", businessName: "Walk In" });
    expect(r.status).toBe(403);
    expect((await signup("walkin@example.com", "x".repeat(43), "123456")).status).toBe(403);
  });

  it("only the platform admin can create or list invitations", async () => {
    expect((await call("POST", "/platform/invites", { email: "a@example.com" })).status).toBe(401);
    expect((await call("GET", "/platform/invites")).status).toBe(401);
  });

  it("a valid link + PIN opens exactly one business, once, for the invited email only", async () => {
    const inv = await invite("Client@Example.com", { businessName: "Mama Njeri Mart" });
    expect(inv.token.length).toBeGreaterThan(30);
    expect(inv.pin).toMatch(/^\d{6}$/);
    expect((await call("GET", `/auth/invite/${inv.token}`)).body.data).toEqual({ email: "client@example.com", businessName: "Mama Njeri Mart" });
    expect((await call("GET", `/auth/invite/${"z".repeat(43)}`)).status).toBe(404);

    expect((await signup("someone.else@example.com", inv.token, inv.pin)).status).toBe(403); // different email
    const wrongPin = inv.pin === "000000" ? "111111" : "000000";
    expect((await signup("client@example.com", inv.token, wrongPin)).status).toBe(403);
    const ok = await signup("client@example.com", inv.token, inv.pin);
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.data.token).toBeTruthy();
    expect((await signup("client@example.com", inv.token, inv.pin)).status).toBe(403); // single use
    expect((await call("GET", `/auth/invite/${inv.token}`)).status).toBe(404);
    const stored = await query<{ token_hash: string; pin_hash: string }>(`select token_hash, pin_hash from business_invites where email = 'client@example.com'`);
    expect(stored[0]!.token_hash).not.toContain(inv.token);
  });

  it("five wrong PINs burn the invitation", async () => {
    const inv = await invite("burn@example.com");
    const wrong = inv.pin === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) expect((await signup("burn@example.com", inv.token, wrong)).status).toBe(403);
    expect((await signup("burn@example.com", inv.token, inv.pin)).status).toBe(403);
  });

  it("expired and cancelled invitations stop working; a newer invitation replaces an older one", async () => {
    const old = await invite("expire@example.com");
    await query(`update business_invites set expires_at = now() - interval '1 minute' where id = $1`, [old.id]);
    expect((await signup("expire@example.com", old.token, old.pin)).status).toBe(403);

    const a = await invite("swap@example.com");
    const b = await invite("swap@example.com");
    expect((await signup("swap@example.com", a.token, a.pin)).status).toBe(403);
    expect((await call("POST", `/platform/invites/${b.id}/revoke`, { reason: "client changed mind" }, admin)).status).toBe(200);
    expect((await signup("swap@example.com", b.token, b.pin)).status).toBe(403);
    const list = (await call("GET", "/platform/invites", undefined, admin)).body.data as { email: string; status: string }[];
    expect(list.filter((i) => i.email === "swap@example.com").map((i) => i.status).sort()).toEqual(["cancelled", "cancelled"]);
    expect(JSON.stringify(list)).not.toContain(a.token);
  });

  it("an email that already has an account cannot be invited", async () => {
    expect((await call("POST", "/platform/invites", { email: "client@example.com" }, admin)).status).toBe(409);
  });

  it("'approve later' invitations create a business that cannot be used until the platform approves it", async () => {
    const inv = await invite("pending@example.com", { autoApprove: false });
    const r = await signup("pending@example.com", inv.token, inv.pin);
    expect(r.status).toBe(201);
    const bizId = r.body.data.businesses[0].id as string;
    const auth = { Authorization: `Bearer ${r.body.data.token}`, "X-Business-ID": bizId };
    const blocked = await call("GET", "/products", undefined, auth);
    expect(blocked.status).toBe(403);
    expect(blocked.body.message).toMatch(/waiting for approval/);
    const overview = (await call("GET", "/platform/overview", undefined, admin)).body.data;
    expect(overview.totals.pending).toBe(1);
    expect((await call("POST", `/platform/businesses/${bizId}/approve`, { reason: "Deposit received" }, admin)).status).toBe(200);
    expect((await call("GET", "/products", undefined, auth)).status).toBe(200);
    expect((await call("POST", `/platform/businesses/${bizId}/reject`, { reason: "Changed our mind" }, admin)).status).toBe(200);
    const again = await call("GET", "/products", undefined, auth);
    expect(again.status).toBe(403);
    expect(again.body.message).toMatch(/not approved/);
  });

  it("a business a signed-in user adds later also waits for approval", async () => {
    const inv = await invite("second@example.com");
    const r = await signup("second@example.com", inv.token, inv.pin);
    const add = await call("POST", "/businesses", { name: "Second Shop" }, { Authorization: `Bearer ${r.body.data.token}` });
    expect(add.status, JSON.stringify(add.body)).toBe(201);
    expect(add.body.data.approvalStatus).toBe("pending");
  });

  it("an invitation can choose the package: the client's business starts as a hotel with hotel roles", async () => {
    const bad = await call("POST", "/platform/invites", { email: "badpkg@example.com", package: "casino" }, admin);
    expect(bad.status).toBe(400);
    const inv = await invite("hotelier@example.com", { package: "hotel", autoApprove: true });
    const r = await signup("hotelier@example.com", inv.token, inv.pin, { businessType: "other" });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const bizId = r.body.data.businesses[0].id as string;
    const auth = { Authorization: `Bearer ${r.body.data.token}`, "X-Business-ID": bizId };
    const ctx = (await call("POST", "/business-context/select", { businessId: bizId }, auth)).body.data;
    expect(ctx.package).toBe("hotel");
    expect(ctx.modules).toEqual(expect.arrayContaining(["tables", "rooms"]));
    const listed = (await call("GET", "/platform/invites", undefined, admin)).body.data as any[];
    expect(listed.find((i) => i.id === inv.id).package).toBe("hotel");
  });
});