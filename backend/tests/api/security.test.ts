import { describe, it, expect, beforeAll, afterAll } from "vitest";
import jwt from "jsonwebtoken";
import { query, resetData } from "../support/db.js";
import { loadTestConfig } from "../support/env.js";
import { get, post } from "../support/http.js";
import { startServer, waitForHealth, type RunningServer } from "../support/server.js";
import { PASSWORD, registerTenant } from "../support/seed.js";

const cfg = loadTestConfig();
const base = cfg.apiBase;

const goodRegistration = (email: string) => ({
  name: "Test User", email, password: PASSWORD, businessName: "Shop", businessType: "retail",
});

describe("API security hardening", () => {
  beforeAll(resetData);

  describe("HTTP headers, CORS and request handling", () => {
    it("sends security headers and hides the framework", async () => {
      const res = await fetch(`${base}/health`);
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("x-powered-by")).toBeNull();
      expect(res.headers.get("strict-transport-security")).toBeTruthy();
    });

    it("allows the configured front-end origin and refuses others", async () => {
      const ok = await fetch(`${base}/health`, { headers: { origin: "http://localhost:5173" } });
      expect(ok.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
      const bad = await fetch(`${base}/health`, { headers: { origin: "https://evil.example" } });
      expect(bad.headers.get("access-control-allow-origin")).toBeNull();
    });

    it("answers a CORS preflight for the headers the app uses", async () => {
      const res = await fetch(`${base}/sales`, {
        method: "OPTIONS",
        headers: {
          origin: "http://localhost:5173",
          "access-control-request-method": "POST",
          "access-control-request-headers": "authorization,x-business-id,idempotency-key,content-type",
        },
      });
      expect(res.status).toBeLessThan(300);
      const allowed = (res.headers.get("access-control-allow-headers") ?? "").toLowerCase();
      for (const h of ["authorization", "x-business-id", "idempotency-key"]) expect(allowed).toContain(h);
    });

    it("returns clean JSON for malformed bodies, oversized bodies and unknown routes", async () => {
      const bad = await fetch(`${base}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" });
      expect(bad.status).toBe(400);
      expect((await bad.json()).message).toBe("Request body is not valid JSON");

      const big = await fetch(`${base}/auth/login`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "a@b.co", password: "x".repeat(300_000) }),
      });
      expect(big.status).toBe(413);

      const missing = await fetch(`${base}/does-not-exist`);
      expect(missing.status).toBe(404);
      expect((await missing.json()).success).toBe(false);
    });

    it("never leaks internals on unexpected failures", async () => {
      const t = await registerTenant("Leak Shop");
      const res = await get("/sales/not-a-number", t);
      const text = JSON.stringify(res.body);
      expect(text).not.toMatch(/BigInt|Cannot convert|prisma|SyntaxError|\.ts:\d+|node_modules/i);
    });
  });

  describe("registration validation", () => {
    it.each([
      ["invalid email", { email: "not-an-email" }],
      ["empty name", { name: "   " }],
      ["name over 255 characters", { name: "x".repeat(256) }],
      ["business name over 255 characters", { businessName: "x".repeat(256) }],
      ["unknown business type", { businessType: "spaceship" }],
      ["password under 8 characters", { password: "short" }],
      ["password over 72 bytes", { password: "p".repeat(73) }],
      ["non-text fields", { name: { $ne: null } }],
    ])("rejects %s with 400", async (_label, override) => {
      const res = await post("/auth/register", undefined, { ...goodRegistration(`v-${Math.random()}@nexa-test.example`), ...override });
      expect(res.status).toBe(400);
    });

    it("answers a duplicate email with 409, and simultaneous duplicates create exactly one account", async () => {
      const email = `race-${Date.now()}@nexa-test.example`;
      const results = await Promise.all(
        Array.from({ length: 6 }, () => post("/auth/register", undefined, goodRegistration(email)))
      );
      const statuses = results.map((r) => r.status).sort();
      expect(statuses.filter((s) => s === 201)).toHaveLength(1);
      expect(statuses.filter((s) => s === 409)).toHaveLength(5);
      const users = await query(`select count(*)::int as n from users where email = $1`, [email]);
      expect(users[0]!.n).toBe(1);
    });

    it("never stores the password in clear text", async () => {
      const t = await registerTenant("Hash Shop");
      const [u] = await query(`select password_hash from users where id = $1`, [t.userId]);
      expect(u!.password_hash).toMatch(/^\$2[aby]\$/);
      expect(u!.password_hash).not.toContain(PASSWORD);
    });
  });

  describe("login and tokens", () => {
    it("treats unknown email and wrong password identically", async () => {
      const t = await registerTenant("Same Msg Shop");
      const wrongPw = await post("/auth/login", undefined, { email: t.email, password: "wrong-password" });
      const noUser = await post("/auth/login", undefined, { email: "nobody@nexa-test.example", password: "wrong-password" });
      expect(wrongPw.status).toBe(401);
      expect(noUser.status).toBe(401);
      expect(noUser.body.message).toBe(wrongPw.body.message);
    });

    it("rejects non-string credentials with 400 (no operator injection)", async () => {
      const res = await post("/auth/login", undefined, { email: { $ne: "" }, password: { $ne: "" } });
      expect(res.status).toBe(400);
    });

    it("refuses a deactivated account at login and for tokens already issued", async () => {
      const t = await registerTenant("Deactivated Shop");
      expect((await get("/products", t)).status).toBe(200);
      await query(`update users set is_active = false where id = $1`, [t.userId]);
      expect((await get("/products", t)).status).toBe(401);
      expect((await post("/auth/login", undefined, { email: t.email, password: t.password })).status).toBe(401);
    });

    it("rejects expired tokens, tokens signed with another secret, and alg=none", async () => {
      const t = await registerTenant("Token Shop");
      const expired = jwt.sign({ userId: t.userId }, cfg.jwtSecret, { expiresIn: -10 });
      const foreign = jwt.sign({ userId: t.userId }, "some-other-secret-value-1234567890");
      const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString("base64url")}.${Buffer.from(JSON.stringify({ userId: t.userId })).toString("base64url")}.`;
      for (const token of [expired, foreign, none]) {
        expect((await get("/products", { token, businessId: t.businessId })).status).toBe(401);
      }
    });
  });

  describe("rate limiting and startup safety (separate server instances)", () => {
    let limited: RunningServer;
    const port = cfg.apiPort + 1;

    beforeAll(async () => {
      limited = startServer(port, { LOGIN_RATE_LIMIT_MAX: "3", REGISTER_RATE_LIMIT_MAX: "2" });
      await waitForHealth(`http://127.0.0.1:${port}/api/health`, 40_000, limited);
    });
    afterAll(async () => { await limited?.stop(); });

    const call = (path: string, body: unknown) =>
      fetch(`http://127.0.0.1:${port}/api${path}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });

    it("throttles repeated login attempts with 429", async () => {
      const codes: number[] = [];
      for (let i = 0; i < 5; i++) codes.push((await call("/auth/login", { email: "x@nexa-test.example", password: "nope-nope" })).status);
      expect(codes.slice(0, 3)).toEqual([401, 401, 401]);
      expect(codes.slice(3)).toEqual([429, 429]);
    });

    it("throttles repeated registrations with 429", async () => {
      const codes: number[] = [];
      for (let i = 0; i < 3; i++) codes.push((await call("/auth/register", goodRegistration(`rl-${i}-${Date.now()}@nexa-test.example`))).status);
      expect(codes).toEqual([201, 201, 429]);
    });

    it("refuses to start without JWT_SECRET", async () => {
      const broken = startServer(cfg.apiPort + 2, { JWT_SECRET: "" });
      const code = await Promise.race([broken.exited, new Promise<string>((r) => setTimeout(() => r("still-running"), 15_000))]);
      await broken.stop();
      expect(code).not.toBe("still-running");
      expect(code).not.toBe(0);
      expect(broken.logs()).toContain("JWT_SECRET is not set");
    });
  });
});
