import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import crypto from "node:crypto";
import { query, resetData } from "../support/db.js";
import { loadTestConfig } from "../support/env.js";
import { startServer, waitForHealth, type RunningServer } from "../support/server.js";
import { addEmployee, createCustomer, createProduct, registerTenant, type Tenant } from "../support/seed.js";

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

  // ---------------- 2b: using a confirmed payment for a sale ----------------
  const confirmed = async (t: Tenant, amount: string, receipt: string) => {
    const r = await pay(t, { amount });
    const p = lastPush();
    queryState.set(p.checkoutId, "success");
    await callbackTo(p, success(Number(amount), receipt));
    const g = await call("GET", `/integrations/mpesa/payment-requests/${r.body.data.id}`, t);
    expect(g.body.data.status).toBe("paid");
    return g.body.data.id as string;
  };
  const sale = (t: Tenant, productId: string, qty: number, over: Record<string, unknown> = {}, extra: Record<string, string> = {}) =>
    call("POST", "/sales", t, { amountPaid: qty * 1000, paymentMethod: "mpesa", items: [{ productId, quantity: qty, unitPrice: 1000 }], ...over }, extra);
  const salesCount = async (t: Tenant) => Number((await query<{ c: string }>(`select count(*) c from sales where business_id = $1`, [t.businessId]))[0]!.c);

  describe("sale linking", () => {
    let product: string;
    beforeAll(async () => { product = (await createProduct(owner, { name: "Link Item", costPrice: 100, sellingPrice: 1000, stockQuantity: 500 })).id; });

    it("tells a till only whether M-PESA is on, and nothing else", async () => {
      const r = await call("GET", "/integrations/mpesa/status", cashier);
      expect(r.status).toBe(200);
      expect(Object.keys(r.body.data).sort()).toEqual(["enabled", "environment"]);
      expect(r.body.data.enabled).toBe(true);
      expect((await call("GET", "/integrations/mpesa/status", nobody)).status).toBe(403);
      const fresh = await registerTenant("No Pay Shop");
      expect((await call("GET", "/integrations/mpesa/status", fresh)).body.data).toEqual({ enabled: false, environment: null });
    });

    it("a confirmed payment becomes the sale's payment, with the Safaricom receipt", async () => {
      const id = await confirmed(owner, "2000", "LINKRCPT01");
      const r = await sale(owner, product, 2, { mpesaPaymentRequestId: id });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      const pays = await query<{ method: string; reference: string; amount: string }>(
        `select p.method, p.reference, p.amount::text from payments p join sales s on s.id = p.sale_id where s.public_id = $1::uuid`, [r.body.data.id]);
      expect(pays).toEqual([{ method: "mpesa", reference: "LINKRCPT01", amount: "2000.00" }]);
      const link = await query<{ ok: boolean }>(`select (sale_id = (select id from sales where public_id = $1::uuid)) ok from mpesa_payment_requests where public_id = $2::uuid`, [r.body.data.id, id]);
      expect(link[0]!.ok).toBe(true);
    });

    it("the same confirmed payment cannot be spent twice, not even at the same moment", async () => {
      const id = await confirmed(owner, "1000", "RACEPAY001");
      const before = await salesCount(owner);
      const results = await Promise.all([1, 2, 3].map(() => sale(owner, product, 1, { mpesaPaymentRequestId: id })));
      expect(results.filter((x) => x.status === 201).length).toBe(1);
      expect(results.filter((x) => x.status === 409).length).toBe(2);
      expect(await salesCount(owner)).toBe(before + 1);
      const again = await sale(owner, product, 1, { mpesaPaymentRequestId: id });
      expect(again.status).toBe(409);
      expect(again.body.message).toMatch(/already used/);
    });

    it("refuses an unconfirmed, mismatched, wrong-method, foreign or malformed payment, and creates no sale", async () => {
      const before = await salesCount(owner);
      const pending = await pay(owner, { amount: "1000" });
      const pr = await sale(owner, product, 1, { mpesaPaymentRequestId: pending.body.data.id });
      expect(pr.status).toBe(409);
      expect(pr.body.message).toMatch(/not been confirmed/);

      const paid = await confirmed(owner, "1000", "MISMATCH001");
      const wrongAmount = await sale(owner, product, 2, { mpesaPaymentRequestId: paid });
      expect(wrongAmount.status).toBe(409);
      expect(wrongAmount.body.message).toMatch(/exactly that/);
      expect((await sale(owner, product, 1, { mpesaPaymentRequestId: paid, paymentMethod: "cash" })).status).toBe(400);
      expect((await sale(other, product, 1, { mpesaPaymentRequestId: paid })).status).toBeGreaterThanOrEqual(400);
      expect((await sale(owner, product, 1, { mpesaPaymentRequestId: "nope" })).status).toBe(400);
      expect((await sale(owner, product, 1, { mpesaPaymentRequestId: crypto.randomUUID() })).status).toBe(404);
      expect(await salesCount(owner)).toBe(before);
      // ...and the payment is still unspent: the right sale can still use it.
      expect((await sale(owner, product, 1, { mpesaPaymentRequestId: paid })).status).toBe(201);
    });

    it("a part-payment by M-PESA leaves the rest owing, as before", async () => {
      const c = await createCustomer(owner, "Credit Customer", "0722000111");
      const id = await confirmed(owner, "500", "PARTPAY001");
      const r = await sale(owner, product, 2, { customerId: c.id, amountPaid: 500, mpesaPaymentRequestId: id });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      const [row] = await query<{ b: string }>(`select balance_due::text b from sales where public_id = $1::uuid`, [r.body.data.id]);
      expect(row!.b).toBe("1500.00");
    });

    it("a retried sale (same Idempotency-Key) returns the same sale instead of failing", async () => {
      const id = await confirmed(owner, "1000", "IDEMPOTNT1");
      const hdr = { "Idempotency-Key": "sale-idem-0001-abcdef" };
      const a = await sale(owner, product, 1, { mpesaPaymentRequestId: id }, hdr);
      const b = await sale(owner, product, 1, { mpesaPaymentRequestId: id }, hdr);
      expect(a.status).toBe(201);
      expect(b.body.data.id).toBe(a.body.data.id);
    });

    it("manual M-Pesa codes still work exactly as before", async () => {
      const r = await sale(owner, product, 1, { paymentReference: "MANUALCODE" });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect((await sale(owner, product, 1, { paymentReference: "MANUALCODE" })).status).toBe(409); // old duplicate-code rule intact
    });

    it("the database only links a PAID request to a sale of the same business", async () => {
      const pending = await pay(owner, { amount: "100" });
      const [s] = await query<{ id: string }>(`select id from sales where business_id = $1 limit 1`, [owner.businessId]);
      await expect(query(`update mpesa_payment_requests set sale_id = $1 where public_id = $2::uuid`, [s!.id, pending.body.data.id])).rejects.toThrow(/only a paid/);
      const paidOther = await confirmed(owner, "100", "CROSSBIZ001");
      const otherSale = await createProduct(other, { name: "Other Item", costPrice: 1, sellingPrice: 10, stockQuantity: 5 });
      const os = await call("POST", "/sales", other, { amountPaid: 10, paymentMethod: "cash", items: [{ productId: otherSale.id, quantity: 1, unitPrice: 10 }] });
      expect(os.status).toBe(201);
      const [osRow] = await query<{ id: string }>(`select id from sales where public_id = $1::uuid`, [os.body.data.id]);
      await expect(query(`update mpesa_payment_requests set sale_id = $1 where public_id = $2::uuid`, [osRow!.id, paidOther])).rejects.toThrow(/different businesses/);
    });
  });

  describe("payments needing attention", () => {
    let product: string;
    beforeAll(async () => { product = (await createProduct(owner, { name: "Attention Item", costPrice: 100, sellingPrice: 1000, stockQuantity: 100 })).id; });

    it("lists confirmed-but-unused payments and unconfirmed requests, for people who may see payments", async () => {
      const lonely = await confirmed(owner, "750", "LONELYPAY1");
      const dead = await pay(owner, { phone: "0711000003" }); // network failure -> unconfirmed
      const r = await call("GET", "/integrations/mpesa/attention", owner);
      expect(r.status).toBe(200);
      const u = r.body.data.unlinked.find((x: any) => x.id === lonely);
      expect(u).toMatchObject({ amount: "750.00", mpesaReceipt: "LONELYPAY1", phone: "254*****678" });
      expect(u.requestedBy).toBeTruthy();
      expect(r.body.data.review.map((x: any) => x.id)).toContain(dead.body.data.id);
      expect(JSON.stringify(r.body)).not.toMatch(/callback|token/i);
      expect((await call("GET", "/integrations/mpesa/attention", nobody)).status).toBe(403);
      expect((await call("GET", "/integrations/mpesa/attention", cashier)).status).toBe(403); // cashiers cannot see all payments
      const theirs = await call("GET", "/integrations/mpesa/attention", other);
      expect(JSON.stringify(theirs.body)).not.toContain(lonely);
    });

    it("ringing the sale up with that receipt by hand settles the payment and clears it from the list", async () => {
      const listed = async (id: string) => (await call("GET", "/integrations/mpesa/attention", owner)).body.data.unlinked.some((x: any) => x.id === id);
      // Amount differs from what Safaricom confirmed: the manual sale is allowed (it is only a typed code) but a person must look.
      const odd = await confirmed(owner, "1000", "ODDAMOUNT1");
      const c = await createCustomer(owner, "Fix Customer", "0733000222");
      expect((await sale(owner, product, 2, { amountPaid: 1500, customerId: c.id, paymentReference: "ODDAMOUNT1" })).status).toBe(201);
      expect(await listed(odd)).toBe(true);
      // Exact amount: it settles the confirmed payment and the list is clear.
      const id = await confirmed(owner, "1000", "MANUALFIX1");
      expect(await listed(id)).toBe(true);
      const ok = await sale(owner, product, 1, { paymentReference: "MANUALFIX1" });
      expect(ok.status, JSON.stringify(ok.body)).toBe(201);
      expect(await listed(id)).toBe(false);
      const row = await query<{ ok: boolean }>(`select (sale_id = (select id from sales where public_id = $1::uuid)) ok from mpesa_payment_requests where public_id = $2::uuid`, [ok.body.data.id, id]);
      expect(row[0]!.ok).toBe(true);
    });

    it("an owner can dismiss a payment with a written reason, see it, and restore it; nothing is deleted", async () => {
      const id = await confirmed(owner, "640", "DISMISSME1");
      const dismiss = (t: Tenant, note?: unknown, rid = id) => call("POST", `/integrations/mpesa/payment-requests/${rid}/dismiss`, t, note === undefined ? {} : { note });
      const lists = async () => (await call("GET", "/integrations/mpesa/attention", owner)).body.data;
      // who may: not a cashier, not someone who can only view payments
      expect((await dismiss(cashier, "refunded the customer in person")).status).toBe(403);
      expect((await dismiss(nobody, "refunded the customer in person")).status).toBe(403);
      // a real reason is required
      expect((await dismiss(owner)).status).toBe(400);
      expect((await dismiss(owner, "no")).status).toBe(400);
      expect((await dismiss(owner, "x".repeat(301))).status).toBe(400);
      expect((await dismiss(other, "refunded the customer in person")).status).toBe(404); // another business
      expect((await dismiss(owner, "refunded the customer in person", "not-a-uuid")).status).toBe(400);

      const ok = await dismiss(owner, "  Refunded customer by M-PESA reversal, ref ABC123  ");
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      let d = await lists();
      expect(d.unlinked.some((x: any) => x.id === id)).toBe(false);
      const gone = d.dismissed.find((x: any) => x.id === id);
      expect(gone).toMatchObject({ dismissedNote: "Refunded customer by M-PESA reversal, ref ABC123", mpesaReceipt: "DISMISSME1" });
      expect(gone.dismissedBy).toBeTruthy();
      expect((await dismiss(owner, "dismissing twice should fail")).status).toBe(409);

      // still in the database, with who/when/why, and audited
      const row = await query<{ n: string; w: string | null; u: string | null }>(`select dismissed_note n, dismissed_at::text w, dismissed_by_user_id::text u from mpesa_payment_requests where public_id = $1::uuid`, [id]);
      expect(row[0]!.n).toMatch(/ABC123/);
      expect(row[0]!.w).toBeTruthy();
      expect(row[0]!.u).toBe(owner.userId);
      const audit = await query<{ c: string }>(`select count(*) c from integration_audit_logs where action = 'payment_dismissed' and business_id = $1`, [owner.businessId]);
      expect(Number(audit[0]!.c)).toBeGreaterThanOrEqual(1);

      // restore brings it back; only the owner can
      expect((await call("POST", `/integrations/mpesa/payment-requests/${id}/restore`, cashier)).status).toBe(403);
      expect((await call("POST", `/integrations/mpesa/payment-requests/${id}/restore`, owner)).status).toBe(200);
      d = await lists();
      expect(d.unlinked.some((x: any) => x.id === id)).toBe(true);
      expect(d.dismissed.some((x: any) => x.id === id)).toBe(false);
      expect((await call("POST", `/integrations/mpesa/payment-requests/${id}/restore`, owner)).status).toBe(404);
    });

    it("only payments that need attention can be dismissed", async () => {
      const pending = await pay(owner, { amount: "20" });
      const r = await call("POST", `/integrations/mpesa/payment-requests/${pending.body.data.id}/dismiss`, owner, { note: "trying to hide a live request" });
      expect(r.status).toBe(409);
      // a paid payment that already paid for a sale is settled, not 'attention'
      const used = await confirmed(owner, "1000", "USEDALREADY");
      expect((await sale(owner, product, 1, { mpesaPaymentRequestId: used })).status).toBe(201);
      expect((await call("POST", `/integrations/mpesa/payment-requests/${used}/dismiss`, owner, { note: "already used for a sale" })).status).toBe(409);
    });

    it("the database refuses a dismissal without a real reason", async () => {
      const id = await confirmed(owner, "30", "DBRULEONE1");
      await expect(query(`update mpesa_payment_requests set dismissed_at = now(), dismissed_note = 'ab' where public_id = $1::uuid`, [id])).rejects.toThrow(/dismissal_complete/);
      await expect(query(`update mpesa_payment_requests set dismissed_at = now() where public_id = $1::uuid`, [id])).rejects.toThrow(/dismissal_complete/);
    });
  });
});
