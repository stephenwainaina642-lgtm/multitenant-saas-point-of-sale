import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import crypto from "node:crypto";
import { query, resetData } from "../support/db.js";
import { loadTestConfig } from "../support/env.js";
import { startServer, waitForHealth, type RunningServer } from "../support/server.js";
import { addEmployee, registerTenant, type Tenant } from "../support/seed.js";
import { parseTransTime } from "../../src/modules/integrations/mpesa-c2b.service.js";

const cfg = loadTestConfig();
const KEY = crypto.randomBytes(32).toString("base64");
const PORT = cfg.apiPort + 9;
const FAKE = cfg.apiPort + 10;
const BASE = `http://localhost:${PORT}/api`;
const GOOD_KEY = "DarajaGoodConsumerKey1";
const GOOD_SECRET = "DarajaGoodConsumerSecret1";
const PASSKEY = "bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919";

// ---- a fake Safaricom: remembers the registered addresses and, on "simulate", really posts a notification ----
const registered = new Map<string, { confirmation: string; validation: string }>(); // shortcode -> urls
const registerCalls: any[] = [];
let fake: http.Server;
let seq = 0;
const receipt = () => `QW${String(++seq).padStart(4, "0")}${crypto.randomBytes(2).toString("hex").toUpperCase()}`.slice(0, 10);
const stamp = (d = new Date()) => new Date(d.getTime() + 3 * 3600_000).toISOString().replace(/\D/g, "").slice(0, 14);

function startFake() {
  fake = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", async () => {
      const send = (code: number, o: object) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
      const body = raw ? JSON.parse(raw) : {};
      if (req.url?.startsWith("/oauth/v1/generate")) {
        const ok = req.headers.authorization === `Basic ${Buffer.from(`${GOOD_KEY}:${GOOD_SECRET}`).toString("base64")}`;
        return ok ? send(200, { access_token: "tok", expires_in: "3599" }) : send(400, { errorMessage: "bad" });
      }
      if (req.headers.authorization !== "Bearer tok") return send(401, {});
      if (req.url === "/mpesa/c2b/v1/registerurl") {
        registerCalls.push(body);
        if (body.ShortCode === "600999") return send(200, { ResponseCode: "1", ResponseDescription: "URLs are already registered" });
        registered.set(body.ShortCode, { confirmation: body.ConfirmationURL, validation: body.ValidationURL });
        return send(200, { OriginatorCoversationID: "x", ResponseCode: "0", ResponseDescription: "Success" });
      }
      if (req.url === "/mpesa/c2b/v1/simulate") {
        const urls = registered.get(body.ShortCode);
        if (!urls) return send(400, { errorMessage: "no urls" });
        const local = urls.confirmation.replace(/^https?:\/\/[^/]+/, `http://localhost:${PORT}`);
        await fetch(local, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(notice(body.ShortCode, body.Amount, body.BillRefNumber)) });
        return send(200, { ResponseCode: "0", ResponseDescription: "Accept the service request successfully." });
      }
      send(404, {});
    });
  });
  return new Promise<void>((r) => fake.listen(FAKE, r));
}
const notice = (shortCode: string, amount: number | string, billRef = "ACC1", over: Record<string, unknown> = {}) => ({
  TransactionType: "Pay Bill", TransID: receipt(), TransTime: stamp(), TransAmount: String(amount), BusinessShortCode: shortCode,
  BillRefNumber: billRef, InvoiceNumber: "", OrgAccountBalance: "49197.00", ThirdPartyTransID: "", MSISDN: "25470****149",
  FirstName: "John", MiddleName: "", LastName: "Doe", ...over,
});

async function call(method: string, path: string, t: Tenant | null, body?: unknown) {
  const headers: Record<string, string> = { "Content-Type": "application/json", "X-Auth-Mode": "bearer" };
  if (t) { headers.Authorization = `Bearer ${t.token}`; headers["X-Business-ID"] = t.businessPublicId; }
  const res = await fetch(`${BASE}${path}`, { method, headers, ...(body !== undefined && { body: JSON.stringify(body) }) });
  return { status: res.status, body: (await res.json()) as any };
}
const post = (url: string, body: unknown) => fetch(url.replace(/^https?:\/\/[^/]+/, `http://localhost:${PORT}`), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("M-PESA live statement (C2B notifications)", () => {
  let server: RunningServer;
  let owner: Tenant, other: Tenant, cashier: Tenant, viewer: Tenant;
  let urlsOf: (shortcode: string) => { confirmation: string; validation: string };

  const saveMpesa = async (t: Tenant, shortcode: string, environment = "sandbox", transactionType = "CustomerPayBillOnline") => {
    const s = await call("PUT", "/integrations/mpesa", t, { environment, config: { businessShortcode: shortcode, transactionType }, secrets: { consumerKey: GOOD_KEY, consumerSecret: GOOD_SECRET, passkey: PASSKEY } });
    expect(s.status, JSON.stringify(s.body)).toBe(200);
  };
  const statement = (t: Tenant, qs = "") => call("GET", `/integrations/mpesa/statement${qs}`, t);
  const salesBefore = async () => Number((await query<{ c: string }>(`select count(*) c from sales`))[0]!.c);

  beforeAll(async () => {
    await resetData();
    await startFake();
    server = startServer(PORT, { INTEGRATIONS_TEST_PROVIDER_BASE_URL: `http://localhost:${FAKE}`, INTEGRATIONS_ENCRYPTION_KEY: KEY, PUBLIC_API_URL: `http://localhost:${PORT}`, MPESA_CALLBACK_LIMIT: "1000" });
    await waitForHealth(`http://localhost:${PORT}/api/health`, 40_000, server);
    owner = await registerTenant("C2B Shop");
    other = await registerTenant("Other C2B Shop");
    cashier = await addEmployee(owner, "Cashier");
    viewer = await addEmployee(owner, "Viewer", ["payments.view"]);
    urlsOf = (sc) => registered.get(sc)!;
  }, 120_000);
  afterAll(async () => { await server?.stop(); await new Promise((r) => fake?.close(r)); });

  it("parses Safaricom's Nairobi timestamps and refuses impossible ones", () => {
    expect(parseTransTime("20261123093015")!.toISOString()).toBe("2026-11-23T06:30:15.000Z");
    for (const bad of ["20261340000000", "20260231100000", "2026", "abcdefghijklmn", "", undefined, "20261123256000"]) expect(parseTransTime(bad), String(bad)).toBeNull();
  });

  it("registering needs integrations.manage and saved M-PESA settings", async () => {
    expect((await call("POST", "/integrations/mpesa/c2b/register", owner)).body.message).toMatch(/not set up/i);
    await saveMpesa(owner, "600111");
    expect((await call("POST", "/integrations/mpesa/c2b/register", cashier)).status).toBe(403);
    expect((await call("POST", "/integrations/mpesa/c2b/register", null)).status).toBe(401);
  });

  it("registers addresses with a secret token (hex, no words Safaricom forbids) and never stores or shows it", async () => {
    const r = await call("POST", "/integrations/mpesa/c2b/register", owner);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const u = urlsOf("600111");
    expect(u.confirmation).toMatch(/\/api\/integrations\/callbacks\/c2b\/[0-9a-f-]{36}\/[0-9a-f]{64}\/confirmation$/);
    expect(u.validation).toMatch(/\/validation$/);
    expect(u.confirmation).not.toMatch(/mpesa|m-pesa|safaricom|exe|exec|cmd|sql|query/i);
    expect(registerCalls.at(-1).ResponseType).toBe("Completed");
    const token = u.confirmation.split("/").at(-2)!;
    const g = await call("GET", "/integrations/mpesa", owner);
    expect(g.body.data.config.c2bStatus).toBe("registered");
    const dump = JSON.stringify([g.body, await query(`select config from integration_connections`), await query(`select * from integration_events`), await query(`select details from audit_logs`)]);
    expect(dump).not.toContain(token);
  });

  it("Safaricom's refusal is reported honestly and nothing is recorded as registered", async () => {
    const t = await registerTenant("Already Registered Shop");
    await saveMpesa(t, "600999");
    const r = await call("POST", "/integrations/mpesa/c2b/register", t);
    expect(r.status).toBe(502);
    expect(r.body.message).toMatch(/already registered/i);
    expect((await call("GET", "/integrations/mpesa", t)).body.data.config.c2bStatus).toBe("not_registered");
  });

  it("production registration needs an explicit acknowledgement that it is one-time", async () => {
    const t = await registerTenant("Prod Shop");
    await saveMpesa(t, "600222", "production");
    const no = await call("POST", "/integrations/mpesa/c2b/register", t);
    expect(no.status).toBe(400);
    expect(no.body.message).toMatch(/once per shortcode/i);
    expect(registered.has("600222")).toBe(false);
    expect((await call("POST", "/integrations/mpesa/c2b/register", t, { acknowledgeOneTime: true })).status).toBe(200);
    expect(registered.has("600222")).toBe(true);
  });

  it("a notification is recorded once, shown on the statement, and touches no sale", async () => {
    const sales = await salesBefore();
    const n = notice("600111", "1500.00", "ROOM12");
    const u = urlsOf("600111").confirmation;
    const a = await post(u, n);
    expect(await a.json()).toEqual({ ResultCode: 0, ResultDesc: "Confirmation received successfully" });
    for (let i = 0; i < 3; i++) expect((await post(u, n)).status).toBe(200); // Safaricom retries
    const s = await statement(owner);
    expect(s.status).toBe(200);
    const mine = s.body.data.items.filter((x: any) => x.transId === n.TransID);
    expect(mine.length).toBe(1);
    expect(mine[0]).toMatchObject({ amount: "1500.00", billRef: "ROOM12", name: "John Doe", phone: "25470****149", viaTill: null });
    expect(s.body.data.c2b.registered).toBe(true);
    expect(Number(s.body.data.today.total.replace(/,/g, ""))).toBeGreaterThanOrEqual(1500);
    expect(JSON.stringify(s.body)).not.toContain("OrgAccountBalance");
    expect(JSON.stringify(s.body)).not.toContain("49197");
    expect(await salesBefore()).toBe(sales);
    expect(Number((await query<{ c: string }>(`select count(*) c from payments where reference = $1`, [n.TransID]))[0]!.c)).toBe(0);
  });

  it("a wrong token, a made-up connection or the wrong kind of address gets 404 and records nothing", async () => {
    const before = Number((await query<{ c: string }>(`select count(*) c from mpesa_c2b_payments`))[0]!.c);
    const u = urlsOf("600111").confirmation;
    const parts = u.split("/");
    const badToken = [...parts.slice(0, -2), "a".repeat(64), "confirmation"].join("/");
    expect((await post(badToken, notice("600111", "10"))).status).toBe(404);
    const badConn = [...parts.slice(0, -3), crypto.randomUUID(), parts.at(-2), "confirmation"].join("/");
    expect((await post(badConn, notice("600111", "10"))).status).toBe(404);
    const shortToken = [...parts.slice(0, -2), "abc", "confirmation"].join("/");
    expect((await post(shortToken, notice("600111", "10"))).status).toBe(404);
    expect(Number((await query<{ c: string }>(`select count(*) c from mpesa_c2b_payments`))[0]!.c)).toBe(before);
  });

  it("junk behind a valid token is acknowledged but not recorded (wrong shortcode, bad receipt, amount or time)", async () => {
    const u = urlsOf("600111").confirmation;
    const before = Number((await query<{ c: string }>(`select count(*) c from mpesa_c2b_payments`))[0]!.c);
    const junk = [
      notice("999999", "10"), notice("600111", "10", "A", { TransID: "short" }), notice("600111", "10", "A", { TransID: "abc!defghi" }),
      notice("600111", "0"), notice("600111", "-5"), notice("600111", "ten"), notice("600111", "10", "A", { TransTime: "20261399999999" }), {},
    ];
    for (const j of junk) {
      const r = await post(u, j);
      expect(r.status).toBe(200);
    }
    expect(Number((await query<{ c: string }>(`select count(*) c from mpesa_c2b_payments`))[0]!.c)).toBe(before);
    const ev = await query<{ c: string }>(`select count(*) c from integration_events where type = 'c2b_confirmation' and status = 'rejected'`);
    expect(Number(ev[0]!.c)).toBeGreaterThanOrEqual(junk.length);
  });

  it("the validation address always accepts and records nothing", async () => {
    const v = await post(urlsOf("600111").validation, { TransID: "ZZZZZZZZZZ" });
    expect(await v.json()).toEqual({ ResultCode: "0", ResultDesc: "Accepted" });
  });

  it("the statement needs payments.view, supports search and paging, and is private to each business", async () => {
    expect((await statement(cashier)).status).toBe(403); // a cashier is not given other people's incoming money by default
    expect((await statement(viewer)).status).toBe(200);
    expect((await call("GET", "/integrations/mpesa/statement", null)).status).toBe(401);
    const u = urlsOf("600111").confirmation;
    for (let i = 0; i < 5; i++) await post(u, notice("600111", String(100 + i), i === 2 ? "FINDME" : `R${i}`));
    const found = await statement(viewer, "?q=findme");
    expect(found.body.data.items.length).toBe(1);
    expect(found.body.data.items[0].billRef).toBe("FINDME");
    const p1 = await statement(owner, "?limit=3");
    expect(p1.body.data.items.length).toBe(3);
    expect(p1.body.data.hasMore).toBe(true);
    const p2 = await statement(owner, `?limit=3&before=${p1.body.data.items[2].id}`);
    const ids1 = new Set(p1.body.data.items.map((x: any) => x.id));
    expect(p2.body.data.items.every((x: any) => !ids1.has(x.id))).toBe(true);
    expect(p2.body.data.items.length).toBeGreaterThan(0);
    const theirs = await statement(other);
    expect(theirs.body.data.items).toEqual([]);
    expect(theirs.body.data.c2b.registered).toBe(false);
  });

  it("changing the shortcode or environment makes the old registration stop being accepted", async () => {
    const t = await registerTenant("Stale C2B Shop");
    await saveMpesa(t, "600333");
    expect((await call("POST", "/integrations/mpesa/c2b/register", t)).status).toBe(200);
    const u = urlsOf("600333").confirmation;
    expect((await post(u, notice("600333", "50"))).status).toBe(200);
    await saveMpesa(t, "600444"); // shortcode changed: the registration is for 600333
    expect((await post(u, notice("600333", "50"))).status).toBe(404);
    expect((await call("GET", "/integrations/mpesa", t)).body.data.config.c2bStatus).toBe("not_registered");
  });

  it("sandbox test payments arrive on the statement through the real notification path; production refuses them", async () => {
    const r = await call("POST", "/integrations/mpesa/c2b/simulate", owner, { amount: "250", billRef: "TESTREF" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const s = await statement(owner, "?q=TESTREF");
    expect(s.body.data.items.length).toBe(1);
    expect(s.body.data.items[0].amount).toBe("250.00");
    expect((await call("POST", "/integrations/mpesa/c2b/simulate", owner, { amount: "12.5" })).status).toBe(400);
    expect((await call("POST", "/integrations/mpesa/c2b/simulate", cashier, { amount: "10" })).status).toBe(403);
    const prod = await registerTenant("Prod Sim Shop");
    await saveMpesa(prod, "600555", "production");
    await call("POST", "/integrations/mpesa/c2b/register", prod, { acknowledgeOneTime: true });
    expect((await call("POST", "/integrations/mpesa/c2b/simulate", prod, { amount: "10" })).status).toBe(409);
  });

  describe("the database enforces the same rules", () => {
    const ids = async () => (await query<{ b: string; c: string }>(`select business_id::text b, connection_id::text c from mpesa_c2b_payments limit 1`))[0]!;
    it("rejects bad receipts and non-positive amounts, and never records one receipt twice per business", async () => {
      const { b, c } = await ids();
      const ins = (tid: string, amt: number) => query(`insert into mpesa_c2b_payments (business_id, connection_id, environment, trans_id, trans_time, amount_cents, short_code) values ($1,$2,'sandbox',$3,now(),$4,'600111')`, [b, c, tid, amt]);
      await expect(ins("lowercase1", 100)).rejects.toThrow(/trans_id_format/);
      await expect(ins("ABCDEFGHIJ", 0)).rejects.toThrow(/amount_positive/);
      await ins("UNIQUEONE1", 100);
      await expect(ins("UNIQUEONE1", 100)).rejects.toThrow(/duplicate key/);
    });
    it("a row must belong to the same business as its connection", async () => {
      const { c } = await ids();
      const otherBiz = (await query<{ id: string }>(`select id::text from businesses where name = 'Other C2B Shop'`))[0]!.id;
      await expect(query(`insert into mpesa_c2b_payments (business_id, connection_id, environment, trans_id, trans_time, amount_cents, short_code) values ($1,$2,'sandbox','CROSSBIZ01',now(),100,'600111')`, [otherBiz, c])).rejects.toThrow(/different business/);
    });
  });
});
