import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import crypto from "node:crypto";
import { query, resetData } from "../support/db.js";
import { loadTestConfig } from "../support/env.js";
import { startServer, waitForHealth, type RunningServer } from "../support/server.js";
import { addEmployee, registerTenant, type Tenant } from "../support/seed.js";

const cfg = loadTestConfig();
const KEY = crypto.randomBytes(32).toString("base64");
const PORT = cfg.apiPort + 5;
const FAKE = cfg.apiPort + 6;
const BASE = `http://localhost:${PORT}/api`;
const GOOD_KEY = "GoodConsumerKey123456";
const GOOD_SECRET = "GoodConsumerSecret-98765";
const PASSKEY = "bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919";

// ---- a fake Safaricom: records pushes, answers queries from a table the test controls ----
type Push = { body: any; callbackUrl: string; checkoutId: string };
const pushes: Push[] = [];
const queryState = new Map<string, string>(); // checkoutId -> "success" | resultCode | (absent = still processing)
let fake: http.Server;
let counter = 0;
function startFake() {
  fake = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      const send = (code: number, o: object) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
      const body = raw ? JSON.parse(raw) : {};
      if (req.url?.startsWith("/oauth/v1/generate")) {
        const [k, s] = Buffer.from((req.headers.authorization ?? "").replace("Basic ", ""), "base64").toString().split(":");
        return k === GOOD_KEY && s === GOOD_SECRET ? send(200, { access_token: "tok", expires_in: "3599" }) : send(400, {});
      }
      if (req.headers.authorization !== "Bearer tok") return send(401, { errorMessage: "Invalid Access Token" });
      if (req.url === "/mpesa/stkpush/v1/processrequest") {
        if (body.PhoneNumber === "254711000003") return req.socket.destroy();
        if (body.PhoneNumber === "254711000002") return send(400, { errorCode: "400.002.02", errorMessage: "Bad Request - Invalid PhoneNumber" });
        const checkoutId = `ws_CO_${++counter}_${Date.now()}`;
        pushes.push({ body, callbackUrl: body.CallBackURL, checkoutId });
        return send(200, { MerchantRequestID: `mr-${counter}`, CheckoutRequestID: checkoutId, ResponseCode: "0", ResponseDescription: "Success", CustomerMessage: "Success" });
      }
      if (req.url === "/mpesa/stkpushquery/v1/query") {
        const st = queryState.get(body.CheckoutRequestID);
        if (!st) return send(500, { errorCode: "500.001.1001", errorMessage: "The transaction is being processed" });
        return send(200, { ResponseCode: "0", ResultCode: st === "success" ? "0" : st, ResultDesc: st === "success" ? "ok" : "not paid", CheckoutRequestID: body.CheckoutRequestID });
      }
      send(404, {});
    });
  });
  return new Promise<void>((r) => fake.listen(FAKE, r));
}

async function call(method: string, path: string, t: Tenant | null, body?: unknown, extra: Record<string, string> = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json", "X-Auth-Mode": "bearer", ...extra };
  if (t) { headers.Authorization = `Bearer ${t.token}`; headers["X-Business-ID"] = t.businessPublicId; }
  const res = await fetch(`${BASE}${path}`, { method, headers, ...(body !== undefined && { body: JSON.stringify(body) }) });
  return { status: res.status, body: (await res.json()) as any };
}
let n = 0;
const pay = (t: Tenant, over: Record<string, unknown> = {}, key = `key-${Date.now()}-${++n}-abcdef`) =>
  call("POST", "/integrations/mpesa/payment-requests", t, { amount: "1500", phone: "0712345678", accountReference: "INV123", ...over }, { "Idempotency-Key": key });
/** Sends Safaricom's callback to the exact URL the server gave Safaricom. */
const callbackTo = (p: Push, stk: object, path?: string) =>
  fetch(path ?? p.callbackUrl.replace(/^https?:\/\/[^/]+/, `http://localhost:${PORT}`), {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ Body: { stkCallback: { MerchantRequestID: "x", CheckoutRequestID: p.checkoutId, ...stk } } }),
  });
const success = (amount: number, receipt: string) => ({
  ResultCode: 0, ResultDesc: "The service request is processed successfully.",
  CallbackMetadata: { Item: [{ Name: "Amount", Value: amount }, { Name: "MpesaReceiptNumber", Value: receipt }, { Name: "PhoneNumber", Value: 254712345678 }] },
});
const lastPush = () => pushes[pushes.length - 1]!;
const tokenOf = (p: Push) => p.callbackUrl.split("/").pop()!;

describe("M-PESA STK Push (milestone 2a: backend only)", () => {
  let server: RunningServer;
  let owner: Tenant, other: Tenant, cashier: Tenant, nobody: Tenant;

  const setup = async (t: Tenant, extraConfig: Record<string, string> = {}) => {
    const s = await call("PUT", "/integrations/mpesa", t, { environment: "sandbox",
      config: { businessShortcode: "174379", transactionType: "CustomerPayBillOnline", ...extraConfig },
      secrets: { consumerKey: GOOD_KEY, consumerSecret: GOOD_SECRET, passkey: PASSKEY } });
    expect(s.status, JSON.stringify(s.body)).toBe(200);
    expect((await call("POST", "/integrations/mpesa/test", t)).body.data.ok).toBe(true);
    expect((await call("POST", "/integrations/mpesa/enable", t)).status).toBe(200);
  };

  beforeAll(async () => {
    await resetData();
    await startFake();
    server = startServer(PORT, { INTEGRATIONS_TEST_PROVIDER_BASE_URL: `http://localhost:${FAKE}`, INTEGRATIONS_ENCRYPTION_KEY: KEY, PUBLIC_API_URL: `http://localhost:${PORT}`, MPESA_RECHECK_MS: "0", MPESA_REQUEST_LIMIT: "1000" });
    await waitForHealth(`http://localhost:${PORT}/api/health`, 40_000, server);
    owner = await registerTenant("Pay Shop");
    other = await registerTenant("Other Pay Shop");
    cashier = await addEmployee(owner, "Cashier");
    nobody = await addEmployee(owner, "Viewer", ["reports.view"]);
  }, 120_000);
  afterAll(async () => { await server?.stop(); await new Promise((r) => fake?.close(r)); });

  it("refuses until M-PESA is enabled, and without the payments permission", async () => {
    expect((await pay(owner)).status).toBe(409);
    expect((await pay(owner)).body.message).toMatch(/not set up|not enabled/i);
    await setup(owner);
    expect((await pay(nobody)).status).toBe(403);
    expect((await call("POST", "/integrations/mpesa/payment-requests", null, {})).status).toBe(401);
  });

  it("validates amount, phone and the idempotency key", async () => {
    for (const amount of ["0", "-5", "10.50", "abc", "250001"]) expect((await pay(owner, { amount })).status, amount).toBe(400);
    for (const phone of ["12345", "0612345678", "+25571234567", ""]) expect((await pay(owner, { phone })).status, phone).toBe(400);
    expect((await call("POST", "/integrations/mpesa/payment-requests", owner, { amount: "100", phone: "0712345678" })).status).toBe(400);
    expect(pushes.length).toBe(0); // nothing reached Safaricom
  });

  it("sends a correct STK Push and returns a pending request (not a paid one)", async () => {
    const r = await pay(owner, { phone: "+254 712 345 678", amount: "1500" });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data.status).toBe("pending");
    expect(r.body.data.amount).toBe("1500.00");
    expect(r.body.data.phone).toBe("254*****678");
    const text = JSON.stringify(r.body);
    expect(text).not.toContain(tokenOf(lastPush()));
    expect(text).not.toContain("callback");

    const b = lastPush().body;
    expect(b.Amount).toBe(1500);
    expect(b.PhoneNumber).toBe("254712345678");
    expect(b.PartyA).toBe("254712345678");
    expect(b.BusinessShortCode).toBe("174379");
    expect(b.PartyB).toBe("174379");
    expect(b.TransactionType).toBe("CustomerPayBillOnline");
    expect(b.AccountReference).toBe("INV123");
    expect(b.Timestamp).toMatch(/^\d{14}$/);
    expect(Buffer.from(b.Password, "base64").toString()).toBe(`174379${PASSKEY}${b.Timestamp}`);
    expect(lastPush().callbackUrl).toMatch(/\/api\/integrations\/callbacks\/mpesa\/[A-Za-z0-9_-]{40,}$/);
  });

  it("an Idempotency-Key never asks the customer twice", async () => {
    const before = pushes.length;
    const key = "idem-key-0001-abcdef";
    const a = await pay(owner, {}, key);
    const b = await pay(owner, {}, key);
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect(b.body.replayed).toBe(true);
    expect(b.body.data.id).toBe(a.body.data.id);
    expect(pushes.length).toBe(before + 1);
    expect((await pay(owner, { amount: "999" }, key)).status).toBe(409); // same key, different payment
  });

  it("the callback token is stored only as a hash", async () => {
    const t = tokenOf(lastPush());
    const everything = JSON.stringify([
      await query(`select * from mpesa_payment_requests`), await query(`select * from integration_events`),
      await query(`select * from integration_audit_logs`), await query(`select details from audit_logs`),
    ]);
    expect(everything).not.toContain(t);
    const [row] = await query<{ h: string }>(`select callback_token_hash h from mpesa_payment_requests order by id desc limit 1`);
    expect(row!.h).toBe(crypto.createHash("sha256").update(t).digest("hex"));
  });

  it("a callback alone never marks a payment paid: Safaricom must confirm", async () => {
    const r = await pay(owner, { amount: "800" });
    const p = lastPush();
    expect((await callbackTo(p, success(800, "QGH7XK2LMN"))).status).toBe(200); // Safaricom still says "processing"
    expect((await call("GET", `/integrations/mpesa/payment-requests/${r.body.data.id}`, owner)).body.data.status).toBe("pending");
    // Now Safaricom confirms: the status check completes it and keeps the receipt the callback carried.
    queryState.set(p.checkoutId, "success");
    const done = await call("GET", `/integrations/mpesa/payment-requests/${r.body.data.id}`, owner);
    expect(done.body.data.status).toBe("paid");
    expect(done.body.data.mpesaReceipt).toBe("QGH7XK2LMN");
  });

  it("callback + Safaricom confirmation = paid, exactly once", async () => {
    const r = await pay(owner, { amount: "1200" });
    const p = lastPush();
    queryState.set(p.checkoutId, "success");
    expect((await callbackTo(p, success(1200, "RKT9ABCDE1"))).status).toBe(200);
    const g = await call("GET", `/integrations/mpesa/payment-requests/${r.body.data.id}`, owner);
    expect(g.body.data).toMatchObject({ status: "paid", mpesaReceipt: "RKT9ABCDE1", amount: "1200.00" });
    expect(g.body.data.paidAt).toBeTruthy();
    // Safaricom retries/replays and even sends a contradicting failure: a paid request never changes.
    await callbackTo(p, success(1200, "RKT9ABCDE1"));
    await callbackTo(p, { ResultCode: 1032, ResultDesc: "Request cancelled by user" });
    const again = await call("GET", `/integrations/mpesa/payment-requests/${r.body.data.id}`, owner);
    expect(again.body.data.status).toBe("paid");
    const ev = await query<{ c: string }>(`select count(*) c from integration_events where type = 'stk_paid' and payload->>'via' = 'callback+query'`);
    expect(Number(ev[0]!.c)).toBeGreaterThanOrEqual(1);
    const rows = await query<{ c: string }>(`select count(*) c from mpesa_payment_requests where public_id = $1::uuid and status = 'paid' and paid_amount_cents = 120000`, [r.body.data.id]);
    expect(rows[0]!.c).toBe("1");
  });

  it("a callback with the wrong amount or no receipt is held as unconfirmed, not paid", async () => {
    const a = await pay(owner, { amount: "500" });
    const pa = lastPush();
    await callbackTo(pa, success(5, "WRONGAMT01"));
    const get = () => call("GET", `/integrations/mpesa/payment-requests/${a.body.data.id}`, owner);
    expect((await get()).body.data.status).toBe("unconfirmed"); // Safaricom has not confirmed anything
    // Only Safaricom's own word can settle it, and then it is paid at the amount WE requested, never the claimed one.
    queryState.set(pa.checkoutId, "success");
    const settled = (await get()).body.data;
    expect(settled.status).toBe("paid");
    expect(settled.amount).toBe("500.00");
    expect(settled.mpesaReceipt).toBeNull(); // the callback's receipt was not trusted
    const noReceipt = await pay(owner, { amount: "90" });
    await callbackTo(lastPush(), { ResultCode: 0, ResultDesc: "ok", CallbackMetadata: { Item: [{ Name: "Amount", Value: 90 }] } });
    expect((await call("GET", `/integrations/mpesa/payment-requests/${noReceipt.body.data.id}`, owner)).body.data.status).toBe("unconfirmed");
  });

  it("an unknown token is a 404 and a wrong checkout id changes nothing", async () => {
    const r = await pay(owner, { amount: "300" });
    const p = lastPush();
    expect((await callbackTo(p, success(300, "ABCDE12345"), `http://localhost:${PORT}/api/integrations/callbacks/mpesa/${"x".repeat(43)}`)).status).toBe(404);
    const forged = { ...p, checkoutId: "ws_CO_forged" };
    queryState.set(p.checkoutId, "success");
    expect((await callbackTo({ ...forged, callbackUrl: p.callbackUrl }, success(300, "ABCDE12345"))).status).toBe(200);
    // Not paid by the forged callback (the status check below would only confirm via Safaricom for the real id).
    const before = await query<{ s: string }>(`select status s from mpesa_payment_requests where public_id = $1::uuid`, [r.body.data.id]);
    expect(before[0]!.s).toBe("pending");
  });

  it("cancelled, then a late confirmed payment upgrades to paid", async () => {
    const r = await pay(owner, { amount: "250" });
    const p = lastPush();
    await callbackTo(p, { ResultCode: 1032, ResultDesc: "Request cancelled by user" });
    expect((await call("GET", `/integrations/mpesa/payment-requests/${r.body.data.id}`, owner)).body.data.status).toBe("cancelled");
    queryState.set(p.checkoutId, "success");
    expect((await call("GET", `/integrations/mpesa/payment-requests/${r.body.data.id}`, owner)).body.data.status).toBe("paid");
  });

  it("Safaricom rejection is 'failed'; a network failure is 'unconfirmed' and says so", async () => {
    const bad = await pay(owner, { phone: "0711000002" });
    expect(bad.body.data.status).toBe("failed");
    expect(bad.body.data.message).toMatch(/PhoneNumber/);
    const dead = await pay(owner, { phone: "0711000003" });
    expect(dead.body.data.status).toBe("unconfirmed");
    expect(dead.body.data.message).toMatch(/Check with the customer/);
  });

  it("the same M-PESA receipt cannot pay two requests", async () => {
    const mk = async () => { const r = await pay(owner, { amount: "100" }); const p = lastPush(); queryState.set(p.checkoutId, "success"); return { r, p }; };
    const one = await mk(); const two = await mk();
    await callbackTo(one.p, success(100, "DUPLICATE1"));
    await callbackTo(two.p, success(100, "DUPLICATE1"));
    const a = (await call("GET", `/integrations/mpesa/payment-requests/${one.r.body.data.id}`, owner)).body.data;
    const b = (await call("GET", `/integrations/mpesa/payment-requests/${two.r.body.data.id}`, owner)).body.data;
    expect(a.status).toBe("paid");
    expect(b.status).not.toBe("paid");
  });

  it("keeps businesses apart", async () => {
    const r = await pay(owner, { amount: "700" });
    expect((await call("GET", `/integrations/mpesa/payment-requests/${r.body.data.id}`, other)).status).toBe(404);
    expect((await pay(other)).status).toBe(409); // the other business has not enabled M-PESA
    await setup(other, { businessShortcode: "600111", tillNumber: "5300123", transactionType: "CustomerBuyGoodsOnline" });
    const o = await pay(other, { amount: "50" });
    expect(o.status).toBe(201);
    expect(lastPush().body).toMatchObject({ BusinessShortCode: "600111", PartyB: "5300123", TransactionType: "CustomerBuyGoodsOnline" });
    expect((await call("GET", `/integrations/mpesa/payment-requests/${o.body.data.id}`, owner)).status).toBe(404);
    expect((await call("GET", `/integrations/mpesa/payment-requests/not-a-uuid`, owner)).status).toBe(400);
  });

  it("changing credentials switches it off, so no new prompts can be sent", async () => {
    const t = await registerTenant("Switch Shop");
    await setup(t);
    expect((await pay(t)).status).toBe(201);
    await call("PUT", "/integrations/mpesa", t, { secrets: { passkey: PASSKEY.replace("b", "c") } });
    expect((await pay(t)).status).toBe(409);
  });

  it("the database refuses a 'paid' row without a paid time or amount", async () => {
    await expect(query(`update mpesa_payment_requests set status = 'paid' where status = 'pending' and id = (select min(id) from mpesa_payment_requests where status = 'pending')`)).rejects.toThrow(/paid_complete/);
  });

  it("never logs a credential or a callback token", async () => {
    for (const s of [GOOD_KEY, GOOD_SECRET, PASSKEY, KEY, ...pushes.map(tokenOf)]) expect(server.logs()).not.toContain(s);
  });
});
