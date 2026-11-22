import { describe, it, expect, beforeAll } from "vitest";
import bcrypt from "bcryptjs";
import { query, resetData } from "../support/db.js";
import { loadTestConfig } from "../support/env.js";
import { api, get, post } from "../support/http.js";
import { createProduct, registerTenant, mpesaCode, createCustomer } from "../support/seed.js";
import { base32Decode, base32Encode, encryptSecret, decryptSecret, newTotpSecret, stepAt, totpAt, verifyTotp } from "../../src/platform/totp.js";

process.env.JWT_SECRET = loadTestConfig().jwtSecret; // same key the API under test uses to protect 2FA secrets

const PW = "Platform-Admin-Pass-1";
const line = (productId: string, quantity: number, unitPrice: number) => ({ productId, quantity, unitPrice });

describe("TOTP codes (RFC 6238)", () => {
  // RFC 6238 appendix B, SHA-1 test secret "12345678901234567890", 8-digit codes truncated to our 6 digits
  const secret = base32Encode(Buffer.from("12345678901234567890"));
  it("matches the published test vectors", () => {
    expect(totpAt(secret, stepAt(59_000))).toBe("287082");
    expect(totpAt(secret, stepAt(1111111109_000))).toBe("081804");
    expect(totpAt(secret, stepAt(2000000000_000))).toBe("279037");
  });
  it("accepts 30 s of drift, refuses older codes and refuses a replay", () => {
    const now = 1_700_000_000_000, step = stepAt(now);
    expect(verifyTotp(secret, totpAt(secret, step), 0, now)).toBe(step);
    expect(verifyTotp(secret, totpAt(secret, step - 1), 0, now)).toBe(step - 1);
    expect(verifyTotp(secret, totpAt(secret, step - 2), 0, now)).toBeNull();
    expect(verifyTotp(secret, totpAt(secret, step), step, now)).toBeNull();
    expect(verifyTotp(secret, "12345", 0, now)).toBeNull();
    expect(verifyTotp(secret, "abcdef", 0, now)).toBeNull();
  });
  it("round-trips base32 and encrypted storage, and rejects tampering", () => {
    const s = newTotpSecret();
    expect(base32Encode(base32Decode(s))).toBe(s);
    const enc = encryptSecret(s);
    expect(enc).not.toContain(s);
    expect(decryptSecret(enc)).toBe(s);
    expect(() => decryptSecret(enc.replace(/.$/, (c) => (c === "A" ? "B" : "A")))).toThrow();
  });
});

describe("platform super admin", () => {
  let secret: string;
  let adminToken: string;
  let shop: Awaited<ReturnType<typeof registerTenant>>;
  let idle: Awaited<ReturnType<typeof registerTenant>>;
  const bearer = (token: string) => ({ token } as any);
  const login = (code: string, password = PW, email = "boss@nexa.test") => api("POST", "/platform/login", { body: { email, password, code } });
  const adminGet = (path: string) => api("GET", `/platform${path}`, { session: bearer(adminToken) });
  const adminPost = (path: string, body: unknown) => api("POST", `/platform${path}`, { session: bearer(adminToken), body });
  
  

  beforeAll(async () => {
    await resetData();
    secret = newTotpSecret();
    await query(`insert into platform_admins(name, email, password_hash, totp_secret_enc) values ('Boss', 'boss@nexa.test', $1, $2)`, [await bcrypt.hash(PW, 4), encryptSecret(secret)]);
    shop = await registerTenant("Busy Shop");
    idle = await registerTenant("Idle Shop");
    const p = await createProduct(shop, { name: "Soda", costPrice: 40, sellingPrice: 100, stockQuantity: 100 });
    await post("/sales", shop, { amountPaid: 300, paymentMethod: "cash", items: [line(p.id, 3, 100)] });
    await post("/sales", shop, { amountPaid: 200, paymentMethod: "mpesa", paymentReference: mpesaCode(), items: [line(p.id, 2, 100)] });
    const first = await login(totpAt(secret, stepAt(Date.now())));
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    adminToken = first.body.data.token;
  }, 60_000);

  it("signs in only with the right password AND a live authenticator code, and a code works once", async () => {
    const reused = await login(totpAt(secret, stepAt(Date.now()))); // the code used in beforeAll
    expect(reused.status).toBe(401);
    expect((await login("000000")).status).toBe(401);
    expect((await login(totpAt(secret, stepAt(Date.now()) + 1), "wrong-password-123")).status).toBe(401);
    expect((await login("", PW)).status).toBe(401);
    const messages = new Set([(await login("000000")).body.message, (await login("000000", "x", "nobody@nexa.test")).body.message]);
    expect(messages.size).toBe(1); // unknown e-mail, bad password and bad code are indistinguishable
  });

  it("keeps business tokens and platform tokens apart in both directions", async () => {
    expect((await api("GET", "/platform/overview", { session: shop })).status).toBe(401);
    expect((await api("GET", "/platform/overview")).status).toBe(401);
    expect((await api("GET", "/businesses/current", { session: bearer(adminToken) })).status).toBe(401);
    expect((await adminGet("/me")).body.data.email).toBe("boss@nexa.test");
  });

  it("has no way to sign up as a platform admin", async () => {
    expect([404, 401]).toContain((await api("POST", "/platform/register", { body: { email: "x@y.z", password: PW } })).status);
    expect((await post("/auth/register", undefined, { name: "Sneaky", email: "platform@x.test", password: PW, businessName: "S", isPlatformAdmin: true })).status).toBe(201);
    const [row] = await query<{ n: number }>(`select count(*)::int as n from platform_admins`);
    expect(row!.n).toBe(1);
  });

  it("lists every business with counts, dates and sale totals, but nothing more", async () => {
    const r = await adminGet("/overview");
    expect(r.status).toBe(200);
    const busy = r.body.data.businesses.find((b: any) => b.name === "Busy Shop");
    expect(busy).toMatchObject({ isActive: true, users: 1, products: 1, salesCount: 2, salesTotal: "500.00", sales30dCount: 2, sales30dTotal: "500.00" });
    expect(busy.lastSaleAt).toBeTruthy();
    const quiet = r.body.data.businesses.find((b: any) => b.name === "Idle Shop");
    expect(quiet).toMatchObject({ salesCount: 0, salesTotal: "0.00", lastSaleAt: null });
    expect(r.body.data.totals).toMatchObject({ businesses: 3, suspended: 0, activeLast30Days: 1 });
    const text = JSON.stringify(r.body);
    for (const leak of ["password", "token", "Soda", "customer"]) expect(text.toLowerCase()).not.toContain(leak.toLowerCase());
  });

  it("suspends and reactivates a business, needs a reason, and records both", async () => {
    expect((await adminPost(`/businesses/${idle.businessPublicId}/suspend`, {})).status).toBe(400);
    expect((await adminPost(`/businesses/${idle.businessPublicId}/suspend`, { reason: " " })).status).toBe(400);
    expect((await adminPost(`/businesses/${idle.businessPublicId}/suspend`, { reason: "Unpaid subscription" })).status).toBe(200);
    expect((await adminPost(`/businesses/${idle.businessPublicId}/suspend`, { reason: "again" })).status).toBe(409);

    const blocked = await get("/customers", idle);
    expect(blocked.status).toBe(403);
    expect(blocked.body.message).toMatch(/suspended/i);
    expect((await post("/business-context/select", idle, { businessId: idle.businessPublicId })).body.message).toMatch(/suspended/i);
    expect((await get("/customers", shop)).status).toBe(200); // other businesses unaffected

    expect((await adminPost(`/businesses/${idle.businessPublicId}/reactivate`, { reason: "Paid" })).status).toBe(200);
    expect((await get("/customers", idle)).status).toBe(200);

    const audit = (await adminGet("/audit")).body.data;
    expect(audit.map((a: any) => a.action)).toEqual(["business.reactivate", "business.suspend"]);
    expect(audit[1]).toMatchObject({ reason: "Unpaid subscription", adminName: "Boss", businessId: idle.businessPublicId });
    expect((await adminPost(`/businesses/3f2b1c1e-9d4a-4c55-8a1e-0b9f6d7e1a42/suspend`, { reason: "nope" })).status).toBe(404);
    expect((await adminPost(`/businesses/999999/suspend`, { reason: "nope" })).status).toBe(400); // a sequential id is refused
    expect((await adminPost(`/businesses/abc/suspend`, { reason: "nope" })).status).toBe(400);
  });

  it("without e-mail set up, an owner reset gives a one-time temporary password and signs the owner out", async () => {
    await new Promise((r) => setTimeout(r, 1100)); // JWT issue time has one-second resolution
    const r = await adminPost(`/businesses/${shop.businessPublicId}/reset-owner`, { reason: "Owner locked out, phoned support" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data).toMatchObject({ method: "temporary_password", ownerEmail: shop.email });
    const temp = r.body.data.temporaryPassword as string;
    expect(temp).toHaveLength(14);
    expect((await get("/customers", shop)).status).toBe(401); // old session gone
    expect((await post("/auth/login", undefined, { email: shop.email, password: shop.password })).status).toBe(401);
    expect((await post("/auth/login", undefined, { email: shop.email, password: temp })).status).toBe(200);
    const audit = (await adminGet("/audit")).body.data;
    expect(audit[0]).toMatchObject({ action: "owner.reset_access" });
    expect(JSON.stringify(audit)).not.toContain(temp); // the password is never written to the audit log
    expect((await adminPost(`/businesses/${shop.businessPublicId}/reset-owner`, {})).status).toBe(400);
  });

  it("stops working when the admin is deactivated", async () => {
    await query(`update platform_admins set is_active = false`);
    expect((await adminGet("/overview")).status).toBe(401);
    expect((await login(totpAt(secret, stepAt(Date.now()) + 1))).status).toBe(401);
    await query(`update platform_admins set is_active = true`);
  });
});
