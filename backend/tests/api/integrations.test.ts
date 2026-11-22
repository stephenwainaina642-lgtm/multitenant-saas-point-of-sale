import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import crypto from "node:crypto";
import { query, resetData } from "../support/db.js";
import { loadTestConfig } from "../support/env.js";
import { startServer, waitForHealth, type RunningServer } from "../support/server.js";
import { addEmployee, registerTenant, type Tenant } from "../support/seed.js";

const cfg = loadTestConfig();
const KEY = crypto.randomBytes(32).toString("base64");
process.env.INTEGRATIONS_ENCRYPTION_KEY = KEY; // for the direct encryption tests below
const { encryptCredential, decryptCredential } = await import("../../src/modules/integrations/encryption.js");

const PORT = cfg.apiPort + 2;
const PORT_NOKEY = cfg.apiPort + 3;
const FAKE = cfg.apiPort + 4;
const GOOD_KEY = "GoodConsumerKey123456";
const GOOD_SECRET = "GoodConsumerSecret-98765";
const PASSKEY = "bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919";
const BAD = "BadConsumerKey0000000";
const DEAD = "DeadConsumerKey000000"; // the fake provider hangs up on this one

let fake: http.Server;
function startFake() {
  fake = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      const json = (code: number, o: object) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
      if (req.url?.startsWith("/oauth/v1/generate")) {
        const [k, s] = Buffer.from((req.headers.authorization ?? "").replace("Basic ", ""), "base64").toString().split(":");
        if (k === DEAD) return req.socket.destroy();
        return k === GOOD_KEY && s === GOOD_SECRET ? json(200, { access_token: "x", expires_in: "3599" }) : json(400, { errorMessage: "Bad Request" });
      }
      if (req.url === "/api/Auth/RequestToken") {
        const b = JSON.parse(body || "{}");
        if (b.consumer_key === DEAD) return req.socket.destroy();
        return b.consumer_key === GOOD_KEY && b.consumer_secret === GOOD_SECRET
          ? json(200, { token: "t", status: "200" })
          : json(200, { error: { code: "invalid_consumer_key_or_secret_provided" }, status: "500" });
      }
      json(404, {});
    });
  });
  return new Promise<void>((r) => fake.listen(FAKE, r));
}

function caller(base: string) {
  return async (method: string, path: string, t: Tenant | null, body?: unknown, extra: Record<string, string> = {}) => {
    const headers: Record<string, string> = { "Content-Type": "application/json", "X-Requested-With": "nexapos", Origin: "http://localhost:5173", "X-Auth-Mode": "bearer", ...extra };
    if (t) { headers.Authorization = `Bearer ${t.token}`; headers["X-Business-ID"] = t.businessPublicId; }
    const res = await fetch(`${base}${path}`, { method, headers, ...(body !== undefined && { body: JSON.stringify(body) }) });
    return { status: res.status, body: (await res.json()) as any, raw: "" };
  };
}

const mpesaBody = (key = GOOD_KEY, secret = GOOD_SECRET) => ({
  environment: "sandbox",
  config: { businessShortcode: "174379", transactionType: "CustomerPayBillOnline" },
  secrets: { consumerKey: key, consumerSecret: secret, passkey: PASSKEY },
});

describe("integrations settings (M-PESA / Pesapal / eTIMS)", () => {
  let server: RunningServer;
  let noKey: RunningServer;
  const call = caller(`http://localhost:${PORT}/api`);
  const callNoKey = caller(`http://localhost:${PORT_NOKEY}/api`);
  let owner: Tenant, other: Tenant, cashier: Tenant, manager: Tenant, accountant: Tenant;

  beforeAll(async () => {
    await resetData();
    await startFake();
    const env = { INTEGRATIONS_TEST_PROVIDER_BASE_URL: `http://localhost:${FAKE}` };
    server = startServer(PORT, { ...env, INTEGRATIONS_ENCRYPTION_KEY: KEY });
    noKey = startServer(PORT_NOKEY, { ...env, INTEGRATIONS_ENCRYPTION_KEY: "" });
    await Promise.all([waitForHealth(`http://localhost:${PORT}/api/health`, 40_000, server), waitForHealth(`http://localhost:${PORT_NOKEY}/api/health`, 40_000, noKey)]);
    owner = await registerTenant("Owner Shop");
    other = await registerTenant("Other Shop");
    cashier = await addEmployee(owner, "Cashier");
    manager = await addEmployee(owner, "Manager");
    accountant = await addEmployee(owner, "Accountant", ["reports.view", "integrations.manage"]);
  }, 120_000);
  afterAll(async () => { await server?.stop(); await noKey?.stop(); await new Promise((r) => fake?.close(r)); });

  it("needs a signed-in person with the integrations permission", async () => {
    expect((await call("GET", "/integrations", null)).status).toBe(401);
    expect((await call("GET", "/integrations", cashier)).status).toBe(403);
    // The starter Manager role deliberately does NOT include it.
    expect((await call("GET", "/integrations", manager)).status).toBe(403);
    expect((await call("PUT", "/integrations/mpesa", manager, mpesaBody())).status).toBe(403);
    expect((await call("POST", "/integrations/mpesa/test", cashier)).status).toBe(403);
    expect((await call("GET", "/integrations", owner)).status).toBe(200);
    expect((await call("GET", "/integrations", accountant)).status).toBe(200); // explicitly granted
  });

  it("lists the three providers; eTIMS is honestly unavailable", async () => {
    const r = await call("GET", "/integrations", owner);
    const list = r.body.data.integrations as any[];
    expect(list.map((i) => i.provider)).toEqual(["mpesa", "pesapal", "etims"]);
    expect(r.body.data.encryptionReady).toBe(true);
    expect(list[0].status).toBe("not_configured");
    const etims = list[2];
    expect(etims.available).toBe(false);
    expect(etims.status).toBe("unavailable");
    expect(etims.unavailableReason).toMatch(/KRA/);
    for (const m of ["PUT", "POST"] as const) {
      expect((await call(m, m === "PUT" ? "/integrations/etims" : "/integrations/etims/test", owner, m === "PUT" ? { config: {} } : undefined)).status).toBe(409);
    }
    expect((await call("POST", "/integrations/etims/enable", owner)).status).toBe(409);
    expect((await call("GET", "/integrations/nope", owner)).status).toBe(404);
  });

  it("validates input", async () => {
    const bad = async (b: any) => (await call("PUT", "/integrations/mpesa", owner, b)).status;
    expect(await bad({ config: { businessShortcode: "12" } })).toBe(400);
    expect(await bad({ config: { businessShortcode: "abcde" } })).toBe(400);
    expect(await bad({ config: { transactionType: "Nope" } })).toBe(400);
    expect(await bad({ config: { surprise: "x" } })).toBe(400);
    expect(await bad({ secrets: { passkey: "short" } })).toBe(400);
    expect(await bad({ secrets: { consumerKey: "has spaces in it here" } })).toBe(400);
    expect(await bad({ environment: "staging" })).toBe(400);
    expect(await bad({ extra: 1 })).toBe(400);
    expect(await bad([1])).toBe(400);
    expect(await bad({ secrets: { consumerKey: 12345678901234 } })).toBe(400);
    expect((await call("PUT", "/integrations/pesapal", owner, { config: { notificationEmail: "not-an-email" } })).status).toBe(400);
  });

  it("saves credentials encrypted and never returns them", async () => {
    const r = await call("PUT", "/integrations/mpesa", owner, mpesaBody());
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const text = JSON.stringify(r.body);
    for (const s of [GOOD_KEY, GOOD_SECRET, PASSKEY]) expect(text).not.toContain(s);
    expect(r.body.data.secrets.consumerKey).toEqual({ set: true, hint: GOOD_KEY.slice(-4) });
    expect(r.body.data.secrets.consumerSecret).toEqual({ set: true, hint: null });
    expect(r.body.data.secrets.passkey.hint).toBeNull();
    expect(r.body.data.config.businessShortcode).toBe("174379");
    expect(r.body.data.status).toBe("configured");

    // A fresh read (list and single) are equally clean.
    for (const path of ["/integrations", "/integrations/mpesa"]) {
      const t = JSON.stringify((await call("GET", path, owner)).body);
      for (const s of [GOOD_KEY, GOOD_SECRET, PASSKEY]) expect(t).not.toContain(s);
    }

    // At rest: ciphertext only, with a hint no longer than 4 characters.
    const rows = await query<{ name: string; ciphertext: string; hint: string | null; business_id: string }>(
      `select name, ciphertext, hint, business_id from integration_secrets order by name`);
    expect(rows.map((x) => x.name)).toEqual(["consumerKey", "consumerSecret", "passkey"]);
    for (const row of rows) {
      for (const s of [GOOD_KEY, GOOD_SECRET, PASSKEY]) expect(row.ciphertext).not.toContain(s);
      expect(row.ciphertext.startsWith("v1.")).toBe(true);
      expect(row.business_id).toBe(owner.businessId);
    }
    const cfgRow = await query(`select config::text as c from integration_connections`);
    expect(JSON.stringify(cfgRow)).not.toContain(GOOD_SECRET);
  });

  it("encryption round-trips and is bound to its tenant, provider and field", async () => {
    const [row] = await query<{ ciphertext: string; key_version: number }>(`select ciphertext, key_version from integration_secrets where name = 'consumerSecret'`);
    const ctx = { businessId: BigInt(owner.businessId), provider: "mpesa", name: "consumerSecret" };
    expect(decryptCredential(row!.ciphertext, row!.key_version, ctx)).toBe(GOOD_SECRET);
    expect(() => decryptCredential(row!.ciphertext, 1, { ...ctx, businessId: BigInt(other.businessId) })).toThrow();
    expect(() => decryptCredential(row!.ciphertext, 1, { ...ctx, name: "passkey" })).toThrow();
    expect(() => decryptCredential(row!.ciphertext, 1, { ...ctx, provider: "pesapal" })).toThrow();
    const parts = row!.ciphertext.split(".");
    parts[3] = Buffer.from(Buffer.from(parts[3]!, "base64url").map((b, i) => (i === 0 ? b ^ 1 : b))).toString("base64url");
    expect(() => decryptCredential(parts.join("."), 1, ctx)).toThrow();
    // Random IV: the same value never encrypts the same way twice.
    expect(encryptCredential("same", ctx).ciphertext).not.toBe(encryptCredential("same", ctx).ciphertext);
  });

  it("the database refuses a secret that points at another business's connection", async () => {
    const [conn] = await query<{ id: string }>(`select id from integration_connections limit 1`);
    await expect(query(`insert into integration_secrets(business_id, connection_id, name, ciphertext) values ($1, $2, 'x', 'y')`, [other.businessId, conn!.id]))
      .rejects.toThrow(/different business/);
  });

  it("keeps businesses apart", async () => {
    const r = await call("GET", "/integrations/mpesa", other);
    expect(r.body.data.status).toBe("not_configured");
    expect(r.body.data.config.businessShortcode).toBe("");
    expect(r.body.data.secrets.consumerKey.set).toBe(false);
    // Owner's token cannot be pointed at the other business.
    const cross = await call("GET", "/integrations/mpesa", { ...owner, businessPublicId: other.businessPublicId } as Tenant);
    expect(cross.status).toBe(403);
    // Same provider, different business: own row, no clash.
    expect((await call("PUT", "/integrations/mpesa", other, { config: { businessShortcode: "600111" } })).status).toBe(200);
    expect((await call("GET", "/integrations/mpesa", owner)).body.data.config.businessShortcode).toBe("174379");
  });

  it("test connection: rejected credentials fail clearly and cannot be enabled", async () => {
    await call("PUT", "/integrations/mpesa", owner, { secrets: { consumerKey: BAD } });
    const t = await call("POST", "/integrations/mpesa/test", owner);
    expect(t.status).toBe(200);
    expect(t.body.data.ok).toBe(false);
    expect(t.body.data.message).toMatch(/rejected/i);
    expect(t.body.data.integration.status).toBe("failed");
    const en = await call("POST", "/integrations/mpesa/enable", owner);
    expect(en.status).toBe(409);
  });

  it("test connection: network failure is reported without leaking anything", async () => {
    await call("PUT", "/integrations/mpesa", owner, { secrets: { consumerKey: DEAD } });
    const t = await call("POST", "/integrations/mpesa/test", owner);
    expect(t.body.data.ok).toBe(false);
    expect(t.body.data.message).toMatch(/reach|answer/i);
    expect(JSON.stringify(t.body)).not.toContain(GOOD_SECRET);
  });

  it("test passes, then enable, then changing credentials switches it off again", async () => {
    await call("PUT", "/integrations/mpesa", owner, { secrets: { consumerKey: GOOD_KEY } });
    expect((await call("POST", "/integrations/mpesa/enable", owner)).status).toBe(409); // changed since last test
    const ok = await call("POST", "/integrations/mpesa/test", owner);
    expect(ok.body.data.ok).toBe(true);
    expect(ok.body.data.integration.status).toBe("verified");
    expect(ok.body.data.integration.lastTest.current).toBe(true);

    const en = await call("POST", "/integrations/mpesa/enable", owner);
    expect(en.status).toBe(200);
    expect(en.body.data.status).toBe("enabled");
    expect((await call("POST", "/integrations/mpesa/enable", owner)).body.data.isEnabled).toBe(true); // idempotent

    // Replacing a credential invalidates the verification and disables the integration.
    const re = await call("PUT", "/integrations/mpesa", owner, { secrets: { consumerSecret: GOOD_SECRET } });
    expect(re.body.data.isEnabled).toBe(false);
    expect(re.body.data.status).toBe("configured");
    expect(re.body.data.lastTest.current).toBe(false);

    // A harmless re-save with blanks keeps secrets and changes nothing.
    const keep = await call("PUT", "/integrations/mpesa", owner, { secrets: { passkey: "" } });
    expect(keep.body.data.secrets.passkey.set).toBe(true);
  });

  it("disabling asks for confirmation and is idempotent", async () => {
    await call("POST", "/integrations/mpesa/test", owner);
    expect((await call("POST", "/integrations/mpesa/enable", owner)).status).toBe(200);
    expect((await call("POST", "/integrations/mpesa/disable", owner, {})).status).toBe(400);
    const d = await call("POST", "/integrations/mpesa/disable", owner, { confirm: true });
    expect(d.body.data.isEnabled).toBe(false);
    expect(d.body.data.status).toBe("verified"); // still set up and verified, just off
    expect((await call("POST", "/integrations/mpesa/disable", owner, { confirm: true })).status).toBe(200);
  });

  it("an Idempotency-Key replays the same test instead of calling the provider again", async () => {
    const key = "test-key-abcdef-1";
    const a = await call("POST", "/integrations/mpesa/test", owner, undefined, { "Idempotency-Key": key });
    const b = await call("POST", "/integrations/mpesa/test", owner, undefined, { "Idempotency-Key": key });
    expect(a.body.data.replayed).toBe(false);
    expect(b.body.data.replayed).toBe(true);
    expect(b.body.data.ok).toBe(a.body.data.ok);
    const n = await query<{ c: string }>(`select count(*) c from integration_events where idempotency_key = $1`, [key]);
    expect(n[0]!.c).toBe("1");
    expect((await call("POST", "/integrations/mpesa/test", owner, undefined, { "Idempotency-Key": "no" })).status).toBe(400);
  });

  it("Pesapal: error-bodied 200 counts as a failure; good credentials pass", async () => {
    const body = (k: string) => ({ environment: "sandbox", config: { merchantName: "Owner Shop Ltd", notificationEmail: "pay@owner.test" }, secrets: { consumerKey: k, consumerSecret: GOOD_SECRET } });
    expect((await call("PUT", "/integrations/pesapal", owner, body(BAD))).status).toBe(200);
    expect((await call("POST", "/integrations/pesapal/test", owner)).body.data.ok).toBe(false);
    await call("PUT", "/integrations/pesapal", owner, body(GOOD_KEY));
    const ok = await call("POST", "/integrations/pesapal/test", owner);
    expect(ok.body.data.ok).toBe(true);
    expect(ok.body.data.message).toMatch(/IPN registration is not done/);
    const g = await call("GET", "/integrations/pesapal", owner);
    expect(g.body.data.config.ipnStatus).toBe("not_registered");
  });

  it("audit trails record who did what and never a secret", async () => {
    const logs = await query<{ action: string; details: any }>(`select action, details from integration_audit_logs where business_id = $1 order by id`, [owner.businessId]);
    const actions = logs.map((l) => l.action);
    for (const a of ["credentials_updated", "test_failed", "test_passed", "enabled", "auto_disabled", "disabled"]) expect(actions).toContain(a);
    const everything = JSON.stringify([
      logs,
      await query(`select details from audit_logs where business_id = $1`, [owner.businessId]),
      await query(`select payload from integration_events`),
    ]);
    for (const s of [GOOD_KEY, GOOD_SECRET, PASSKEY, BAD]) expect(everything).not.toContain(s);
    const withUser = await query<{ n: string }>(`select count(*) n from integration_audit_logs where business_id = $1 and user_id = $2`, [owner.businessId, owner.userId]);
    expect(Number(withUser[0]!.n)).toBeGreaterThan(0);
    // Employee-visible audit trail also shows it.
    const main = await query<{ n: string }>(`select count(*) n from audit_logs where business_id = $1 and action like 'integration.%'`, [owner.businessId]);
    expect(Number(main[0]!.n)).toBeGreaterThan(0);
  });

  it("the server's own logs never contain a credential", async () => {
    for (const s of [GOOD_KEY, GOOD_SECRET, PASSKEY, BAD, KEY]) expect(server.logs()).not.toContain(s);
  });

  it("without the server key, credentials are refused and nothing is stored", async () => {
    const l = await callNoKey("GET", "/integrations", owner);
    expect(l.body.data.encryptionReady).toBe(false);
    const before = await query<{ c: string }>(`select count(*) c from integration_secrets`);
    const r = await callNoKey("PUT", "/integrations/pesapal", other, { config: { merchantName: "Other Shop" }, secrets: { consumerKey: GOOD_KEY, consumerSecret: GOOD_SECRET } });
    expect(r.status).toBe(503);
    expect(r.body.message).toMatch(/INTEGRATIONS_ENCRYPTION_KEY/);
    const after = await query<{ c: string }>(`select count(*) c from integration_secrets`);
    expect(after[0]!.c).toBe(before[0]!.c);
    expect((await callNoKey("PUT", "/integrations/pesapal", other, { config: { merchantName: "Other Shop" } })).status).toBe(200);
  });

  it("deleting a business removes its integrations but a connection's audit history survives its row", async () => {
    const t = await registerTenant("Short Lived");
    await call("PUT", "/integrations/pesapal", t, { config: { merchantName: "Short Lived" }, secrets: { consumerKey: GOOD_KEY, consumerSecret: GOOD_SECRET } });
    const [c] = await query<{ id: string }>(`select id from integration_connections where business_id = $1`, [t.businessId]);
    await query(`delete from integration_connections where id = $1`, [c!.id]);
    const left = await query<{ n: string }>(`select count(*) n from integration_audit_logs where business_id = $1 and connection_id is null`, [t.businessId]);
    expect(Number(left[0]!.n)).toBeGreaterThan(0);
    expect((await query<{ n: string }>(`select count(*) n from integration_secrets where business_id = $1`, [t.businessId]))[0]!.n).toBe("0");
  });

  it("rate-limits test connections per person", async () => {
    const t = await registerTenant("Limited");
    await call("PUT", "/integrations/mpesa", t, mpesaBody());
    let last = 0;
    for (let i = 0; i < 11; i++) last = (await call("POST", "/integrations/mpesa/test", t)).status;
    expect(last).toBe(429);
  });

  it("existing business settings still work", async () => {
    expect((await call("GET", "/businesses/current", owner)).status).toBe(200);
    expect((await call("GET", "/tax-rates", owner)).status).toBe(200);
  });
});
