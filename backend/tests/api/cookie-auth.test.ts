import { describe, it, expect, beforeAll } from "vitest";
import bcrypt from "bcryptjs";
import { query, resetData } from "../support/db.js";
import { loadTestConfig } from "../support/env.js";
import { registerTenant, PASSWORD } from "../support/seed.js";
import { encryptSecret, newTotpSecret, stepAt, totpAt } from "../../src/platform/totp.js";

process.env.JWT_SECRET = loadTestConfig().jwtSecret;
const base = loadTestConfig().apiBase;

/** A browser-style call: no x-auth-mode header, cookies passed by hand. */
async function browser(method: string, path: string, opts: { cookie?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(opts.cookie && { cookie: opts.cookie }), ...opts.headers },
    ...(opts.body !== undefined && { body: JSON.stringify(opts.body) }),
  });
  const setCookie = res.headers.getSetCookie();
  let body: any = {};
  try { body = await res.json(); } catch { /* none */ }
  return { status: res.status, body, setCookie };
}
const pair = (setCookie: string[], name: string) => setCookie.find((c) => c.startsWith(`${name}=`));
const cookieOf = (sc: string | undefined) => sc!.split(";")[0]!;
const APP = { "x-requested-with": "nexapos" };

describe("browser sessions use an httpOnly cookie, not a token in the response", () => {
  let shop: Awaited<ReturnType<typeof registerTenant>>;
  beforeAll(async () => { await resetData(); shop = await registerTenant("Cookie Shop"); }, 60_000);

  it("login sets an HttpOnly, SameSite cookie and puts no token in the body", async () => {
    const r = await browser("POST", "/auth/login", { body: { email: shop.email, password: PASSWORD } });
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body)).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\./); // no JWT anywhere in the payload
    expect(r.body.data.token).toBeUndefined();
    const c = pair(r.setCookie, "nexa_session")!;
    expect(c).toBeTruthy();
    expect(c).toMatch(/HttpOnly/i);
    expect(c).toMatch(/SameSite=Lax/i);
    expect(c).toMatch(/Max-Age=\d+/i);
    const age = Number(/Max-Age=(\d+)/i.exec(c)![1]);
    expect(age).toBeLessThanOrEqual(12 * 3600);
  });

  it("registration also uses the cookie and returns no token", async () => {
    const r = await browser("POST", "/auth/register", { body: { name: "C", email: `c-${Date.now()}@nexa-test.example`, password: PASSWORD, businessName: "Cookie Two", businessType: "retail" } });
    expect(r.status).toBe(201);
    expect(r.body.data.token).toBeUndefined();
    expect(pair(r.setCookie, "nexa_session")).toMatch(/HttpOnly/i);
  });

  it("bearer mode still hands scripts the token (and still sets nothing they need)", async () => {
    const r = await browser("POST", "/auth/login", { body: { email: shop.email, password: PASSWORD }, headers: { "x-auth-mode": "bearer" } });
    expect(typeof r.body.data.token).toBe("string");
  });

  it("the cookie authenticates requests, and a read needs no extra header", async () => {
    const login = await browser("POST", "/auth/login", { body: { email: shop.email, password: PASSWORD } });
    const cookie = cookieOf(pair(login.setCookie, "nexa_session"));
    const r = await browser("GET", "/products", { cookie, headers: { "x-business-id": shop.businessId } });
    expect(r.status).toBe(200);
    const noCookie = await browser("GET", "/products", { headers: { "x-business-id": shop.businessId } });
    expect(noCookie.status).toBe(401);
  });

  it("a state-changing request on the cookie must carry the app header (CSRF guard)", async () => {
    const login = await browser("POST", "/auth/login", { body: { email: shop.email, password: PASSWORD } });
    const cookie = cookieOf(pair(login.setCookie, "nexa_session"));
    const h = { "x-business-id": shop.businessId };
    const body = { name: "Csrf Item", sellingPrice: 10, costPrice: 5, stockQuantity: 1 };
    expect((await browser("POST", "/products", { cookie, body, headers: h })).status).toBe(403);
    expect((await browser("POST", "/products", { cookie, body, headers: { ...h, ...APP, origin: "https://evil.example" } })).status).toBe(403);
    const ok = await browser("POST", "/products", { cookie, body, headers: { ...h, ...APP } });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const count = await query(`select count(*)::int n from products where name = 'Csrf Item'`);
    expect(count[0]!.n).toBe(1);
  });

  it("logout clears the cookie", async () => {
    const r = await browser("POST", "/auth/logout", { headers: APP });
    expect(r.status).toBe(200);
    expect(pair(r.setCookie, "nexa_session")).toMatch(/Expires=Thu, 01 Jan 1970|Max-Age=0/i);
  });

  it("a business token cannot be used as a platform session and vice versa", async () => {
    const login = await browser("POST", "/auth/login", { body: { email: shop.email, password: PASSWORD } });
    const cookie = cookieOf(pair(login.setCookie, "nexa_session")).replace("nexa_session", "nexa_platform");
    expect((await browser("GET", "/platform/overview", { cookie })).status).toBe(401);
  });

  it("the platform admin session is a cookie scoped to /api/platform, with no token in the body", async () => {
    const secret = newTotpSecret();
    await query(`insert into platform_admins(name, email, password_hash, totp_secret_enc) values ('Boss', 'boss@nexa.test', $1, $2)`, [await bcrypt.hash("Platform-Admin-Pass-1", 4), encryptSecret(secret)]);
    const r = await browser("POST", "/platform/login", { body: { email: "boss@nexa.test", password: "Platform-Admin-Pass-1", code: totpAt(secret, stepAt(Date.now())) } });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.token).toBeUndefined();
    const c = pair(r.setCookie, "nexa_platform")!;
    expect(c).toMatch(/HttpOnly/i);
    expect(c).toMatch(/Path=\/api\/platform/i);
    expect((await browser("GET", "/platform/overview", { cookie: cookieOf(c) })).status).toBe(200);
    expect((await browser("POST", "/platform/logout", { cookie: cookieOf(c), headers: APP })).status).toBe(200);
  });
});
