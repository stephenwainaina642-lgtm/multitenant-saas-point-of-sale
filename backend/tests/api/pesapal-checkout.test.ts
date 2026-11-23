import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import crypto from "node:crypto";
import { query, resetData } from "../support/db.js";
import { loadTestConfig } from "../support/env.js";
import { startServer, waitForHealth, type RunningServer } from "../support/server.js";
import { addEmployee, createProduct, registerTenant, type Tenant } from "../support/seed.js";

const cfg = loadTestConfig();
const KEY = crypto.randomBytes(32).toString("base64");
const PORT = cfg.apiPort + 7;
const FAKE = cfg.apiPort + 8;
const BASE = `http://localhost:${PORT}/api`;
const GOOD_KEY = "PesapalGoodKey123456";
const GOOD_SECRET = "PesapalGoodSecret-98765";

// ---- a fake Pesapal: records what it is sent, answers status checks from a table the test controls ----
type Order = { body: any; trackingId: string };
const orders: Order[] = [];
const ipns: any[] = [];
type St = { status_code: number; amount?: number; currency?: string; merchant_reference?: string; confirmation_code?: string };
const state = new Map<string, St>(); // trackingId -> what Pesapal says (absent = not found yet)
let fake: http.Server;
let counter = 0;
function startFake() {
  fake = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      const send = (code: number, o: object) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
      const body = raw ? JSON.parse(raw) : {};
      if (req.url === "/api/Auth/RequestToken") {
        return body.consumer_key === GOOD_KEY && body.consumer_secret === GOOD_SECRET
          ? send(200, { token: "ptok", expiryDate: "2099-01-01", error: null, status: "200" })
          : send(200, { token: null, error: { code: "invalid_consumer_key_or_secret_provided" }, status: "500" });
      }
      if (req.headers.authorization !== "Bearer ptok") return send(401, { error: { message: "unauthorized" } });
      if (req.url === "/api/URLSetup/RegisterIPN") {
        ipns.push(body);
        return send(200, { url: body.url, ipn_id: `ipn-${ipns.length}`, error: null, status: "200" });
      }
      if (req.url === "/api/Transactions/SubmitOrderRequest") {
        if (body.amount === 666) return req.socket.destroy();
        if (body.amount === 777) return send(200, { error: { message: "Invalid billing address" }, status: "500" });
        const trackingId = `trk-${++counter}-${Date.now()}`;
        orders.push({ body, trackingId });
        return send(200, { order_tracking_id: trackingId, merchant_reference: body.id, redirect_url: `https://pay.example.test/checkout/${trackingId}`, error: null, status: "200" });
      }
      if (req.url?.startsWith("/api/Transactions/GetTransactionStatus")) {
        const id = new URL(req.url, "http://x").searchParams.get("orderTrackingId")!;
        const s = state.get(id);
        if (!s) return send(200, { status_code: 0, payment_status_description: "INVALID", error: null });
        return send(200, { ...s, payment_status_description: ["INVALID", "COMPLETED", "FAILED", "REVERSED"][s.status_code], payment_method: "Visa", error: null });
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
let ownerIpnUrl = "";
let otherIpnUrl = "";
let n = 0;
const create = (t: Tenant, over: Record<string, unknown> = {}, key = `psp-key-${Date.now()}-${++n}-abcdef`) =>
  call("POST", "/integrations/pesapal/payment-requests", t, { amount: "1500", phone: "0712345678", ...over }, { "Idempotency-Key": key });
const get = (t: Tenant, id: string) => call("GET", `/integrations/pesapal/payment-requests/${id}`, t);
const lastOrder = () => orders[orders.length - 1]!;
const completed = (o: Order, amount: number, code: string, extra: Partial<St> = {}) =>
  state.set(o.trackingId, { status_code: 1, amount, currency: "KES", merchant_reference: o.body.id, confirmation_code: code, ...extra });

describe("Pesapal hosted checkout", () => {
  let server: RunningServer;
  let owner: Tenant, other: Tenant, cashier: Tenant, nobody: Tenant;

  const setup = async (t: Tenant) => {
    const s = await call("PUT", "/integrations/pesapal", t, { environment: "sandbox", config: { merchantName: "Test Merchant" }, secrets: { consumerKey: GOOD_KEY, consumerSecret: GOOD_SECRET } });
    expect(s.status, JSON.stringify(s.body)).toBe(200);
    expect((await call("POST", "/integrations/pesapal/test", t)).body.data.ok).toBe(true);
    expect((await call("POST", "/integrations/pesapal/enable", t)).status).toBe(200);
  };
  const ready = async (t: Tenant) => { await setup(t); expect((await call("POST", "/integrations/pesapal/register-ipn", t)).status).toBe(200); };
  /** Creates an order and has Pesapal confirm it. */
  const confirmed = async (t: Tenant, amount: string, code: string) => {
    const r = await create(t, { amount });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    completed(lastOrder(), Number(amount), code);
    const g = await get(t, r.body.data.id);
    expect(g.body.data.status).toBe("paid");
    return g.body.data.id as string;
  };

  beforeAll(async () => {
    await resetData();
    await startFake();
    server = startServer(PORT, { INTEGRATIONS_TEST_PROVIDER_BASE_URL: `http://localhost:${FAKE}`, INTEGRATIONS_ENCRYPTION_KEY: KEY, PUBLIC_API_URL: `http://localhost:${PORT}`, PESAPAL_RECHECK_MS: "0", MPESA_REQUEST_LIMIT: "1000" });
    await waitForHealth(`http://localhost:${PORT}/api/health`, 40_000, server);
    owner = await registerTenant("Psp Shop");
    other = await registerTenant("Other Psp Shop");
    cashier = await addEmployee(owner, "Cashier");
    nobody = await addEmployee(owner, "Viewer", ["reports.view"]);
  }, 120_000);
  afterAll(async () => { await server?.stop(); await new Promise((r) => fake?.close(r)); });

  it("refuses until Pesapal is enabled AND its notification address is registered", async () => {
    expect((await create(owner)).body.message).toMatch(/not set up|not enabled/i);
    await setup(owner);
    const r = await create(owner);
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/notifications are not registered/i);
    expect((await call("GET", "/integrations/pesapal/status", cashier)).body.data).toEqual({ enabled: false, environment: null });
  });

  it("registering needs integrations.manage, stores no token, and flips the status", async () => {
    expect((await call("POST", "/integrations/pesapal/register-ipn", cashier)).status).toBe(403);
    expect((await call("POST", "/integrations/pesapal/register-ipn", owner)).status).toBe(200);
    expect(ipns.length).toBe(1);
    ownerIpnUrl = ipns[0].url;
    expect(ipns[0].ipn_notification_type).toBe("GET");
    expect(ipns[0].url).toMatch(/\/api\/integrations\/callbacks\/pesapal\/[0-9a-f-]{36}\/[A-Za-z0-9_-]{40,}$/);
    const g = await call("GET", "/integrations/pesapal", owner);
    expect(g.body.data.config.ipnStatus).toBe("registered");
    const token = ipns[0].url.split("/").pop();
    expect(JSON.stringify(g.body)).not.toContain(token);
    expect(JSON.stringify([await query(`select config from integration_connections`), await query(`select * from integration_events`), await query(`select details from audit_logs`)])).not.toContain(token);
    expect((await call("GET", "/integrations/pesapal/status", cashier)).body.data).toEqual({ enabled: true, environment: "sandbox" });
    expect((await call("GET", "/integrations/pesapal/status", nobody)).status).toBe(403);
  });

  it("changing the credentials or environment makes the registration stale", async () => {
    const t = await registerTenant("Stale Shop");
    await ready(t);
    const s = await call("PUT", "/integrations/pesapal", t, { environment: "sandbox", config: {}, secrets: { consumerKey: GOOD_KEY, consumerSecret: GOOD_SECRET } });
    expect(s.status).toBe(200);
    expect((await call("GET", "/integrations/pesapal", t)).body.data.config.ipnStatus).toBe("not_registered");
  });

  it("validates amount, contact and the idempotency key before anything reaches Pesapal", async () => {
    const before = orders.length;
    for (const amount of ["0", "-5", "abc", "99999999999"]) expect((await create(owner, { amount })).status, amount).toBe(400);
    expect((await create(owner, { phone: "", email: "" })).status).toBe(400);
    expect((await create(owner, { phone: "12" })).status).toBe(400);
    expect((await create(owner, { phone: "", email: "not-an-email" })).status).toBe(400);
    expect((await call("POST", "/integrations/pesapal/payment-requests", owner, { amount: "100", phone: "0712345678" })).status).toBe(400);
    expect((await create(nobody)).status).toBe(403);
    expect((await call("POST", "/integrations/pesapal/payment-requests", null, {})).status).toBe(401);
    expect(orders.length).toBe(before);
  });

  it("creates a pending order with the right fields, and never says it is paid", async () => {
    const r = await create(owner, { amount: "1500.50", phone: "0712 345 678", email: "a@b.co" });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data.status).toBe("pending");
    expect(r.body.data.amount).toBe("1500.50");
    expect(r.body.data.checkoutUrl).toMatch(/^https:\/\/pay\.example\.test\/checkout\/trk-/);
    expect(r.body.data.phone).toBe("254*****678");
    expect(JSON.stringify(r.body)).not.toContain("ipn-");
    const b = lastOrder().body;
    expect(b.currency).toBe("KES");
    expect(b.amount).toBe(1500.5);
    expect(b.id).toBe(`NX${r.body.data.id.replace(/-/g, "")}`);
    expect(b.id.length).toBeLessThanOrEqual(50);
    expect(b.notification_id).toBe("ipn-1");
    expect(b.callback_url).toMatch(/\/api\/integrations\/pesapal\/return$/);
    expect(b.billing_address.phone_number).toBe("254712345678");
    expect(b.billing_address.email_address).toBe("a@b.co");
    expect(b.description).toBeTruthy();
  });

  it("an Idempotency-Key never creates two orders", async () => {
    const before = orders.length;
    const key = "psp-idem-0001-abcdef";
    const a = await create(owner, {}, key);
    const b = await create(owner, {}, key);
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect(b.body.replayed).toBe(true);
    expect(b.body.data.id).toBe(a.body.data.id);
    expect(orders.length).toBe(before + 1);
    expect((await create(owner, { amount: "999" }, key)).status).toBe(409);
  });

  it("stays pending until Pesapal's own status says COMPLETED; then paid exactly once", async () => {
    const r = await create(owner, { amount: "800" });
    const o = lastOrder();
    expect((await get(owner, r.body.data.id)).body.data.status).toBe("pending"); // Pesapal: not found yet
    state.set(o.trackingId, { status_code: 0 });
    expect((await get(owner, r.body.data.id)).body.data.status).toBe("pending");
    completed(o, 800, "PSPCODE0001");
    const done = await get(owner, r.body.data.id);
    expect(done.body.data.status).toBe("paid");
    expect(done.body.data.confirmationCode).toBe("PSPCODE0001");
    expect(done.body.data.checkoutUrl).toBeNull();
    expect((await get(owner, r.body.data.id)).body.data.status).toBe("paid");
    const rows = await query<{ c: string }>(`select count(*) c from integration_events where type = 'pesapal_paid'`);
    expect(Number(rows[0]!.c)).toBeGreaterThanOrEqual(1);
  });

  it("a COMPLETED answer that does not match (amount, currency, our reference) is never accepted as paid", async () => {
    for (const [label, change] of [
      ["amount", { amount: 1 }], ["currency", { currency: "USD" }], ["reference", { merchant_reference: "NXSOMEONEELSE" }],
    ] as const) {
      const r = await create(owner, { amount: "500" });
      const o = lastOrder();
      completed(o, 500, `MM${label}1234`, change);
      const g = await get(owner, r.body.data.id);
      expect(g.body.data.status, label).toBe("unconfirmed");
      expect(g.body.data.paidAt ?? null, label).toBeNull();
    }
  });

  it("an unconfirmed request can still be upgraded to paid by a later correct answer", async () => {
    const r = await create(owner, { amount: "500" });
    const o = lastOrder();
    completed(o, 1, "LATER000001");
    expect((await get(owner, r.body.data.id)).body.data.status).toBe("unconfirmed");
    completed(o, 500, "LATER000001");
    expect((await get(owner, r.body.data.id)).body.data.status).toBe("paid");
  });

  it("FAILED is shown as failed; a paid payment is never downgraded, a later REVERSED only flags it", async () => {
    const f = await create(owner, { amount: "300" });
    state.set(lastOrder().trackingId, { status_code: 2 });
    expect((await get(owner, f.body.data.id)).body.data.status).toBe("failed");

    const r = await create(owner, { amount: "400" });
    const o = lastOrder();
    completed(o, 400, "REVTEST0001");
    expect((await get(owner, r.body.data.id)).body.data.status).toBe("paid");
    state.set(o.trackingId, { status_code: 3 });
    const after = await get(owner, r.body.data.id);
    expect(after.body.data.status).toBe("paid");
    expect(after.body.data.reversalNoticed).toBe(true);
    const list = await call("GET", "/integrations/pesapal/attention", owner);
    expect(list.body.data.reversed.map((x: any) => x.id)).toContain(r.body.data.id);
    expect(list.body.data.unlinked.map((x: any) => x.id)).not.toContain(r.body.data.id);
  });

  it("Pesapal being unreachable or rejecting the order is reported honestly", async () => {
    const down = await create(owner, { amount: "666" });
    expect(down.status).toBe(201);
    expect(down.body.data.status).toBe("unconfirmed");
    expect(down.body.data.checkoutUrl).toBeNull();
    const bad = await create(owner, { amount: "777" });
    expect(bad.body.data.status).toBe("failed");
    expect(bad.body.data.message).toMatch(/Invalid billing address/);
  });

  describe("notifications (IPN)", () => {
    const local = (u: string) => u.replace(/^https?:\/\/[^/]+/, `http://localhost:${PORT}`);
    const ipnUrl = () => local(ownerIpnUrl);
    const sendIpn = (url: string, trackingId: string) => fetch(`${url}?OrderTrackingId=${trackingId}&OrderMerchantReference=x&OrderNotificationType=IPNCHANGE`);

    it("an IPN only prompts a re-check; Pesapal's status decides", async () => {
      const r = await create(owner, { amount: "250" });
      const o = lastOrder();
      const res = await sendIpn(ipnUrl(), o.trackingId); // Pesapal still says not found
      expect(res.status).toBe(200);
      expect(((await res.json()) as any).status).toBe(200);
      expect((await get(owner, r.body.data.id)).body.data.status).toBe("pending");
      completed(o, 250, "IPNPAID0001");
      expect((await sendIpn(ipnUrl(), o.trackingId)).status).toBe(200);
      const [row] = await query<{ status: string }>(`select status from pesapal_payment_requests where public_id = $1::uuid`, [r.body.data.id]);
      expect(row!.status).toBe("paid"); // settled by the IPN-triggered check, before anyone polled
    });

    it("a wrong token or unknown connection gets 404 and touches nothing", async () => {
      const r = await create(owner, { amount: "260" });
      const o = lastOrder();
      completed(o, 260, "BADTOKEN001");
      const bad = ipnUrl().replace(/[^/]+$/, "x".repeat(43));
      expect((await sendIpn(bad, o.trackingId)).status).toBe(404);
      expect((await sendIpn(`http://localhost:${PORT}/api/integrations/callbacks/pesapal/${crypto.randomUUID()}/${"y".repeat(43)}`, o.trackingId)).status).toBe(404);
      const [row] = await query<{ status: string }>(`select status from pesapal_payment_requests where public_id = $1::uuid`, [r.body.data.id]);
      expect(row!.status).toBe("pending");
    });

    it("an IPN for another business's order tracking id does nothing", async () => {
      await ready(other);
      otherIpnUrl = ipns[ipns.length - 1].url;
      const mine = await create(owner, { amount: "270" });
      completed(lastOrder(), 270, "CROSSIPN001");
      await sendIpn(local(otherIpnUrl), lastOrder().trackingId); // other's address, owner's order
      const [row] = await query<{ status: string }>(`select status from pesapal_payment_requests where public_id = $1::uuid`, [mine.body.data.id]);
      expect(row!.status).toBe("pending");
    });

    it("the customer return page is plain HTML and reflects nothing", async () => {
      const res = await fetch(`http://localhost:${PORT}/api/integrations/pesapal/return?OrderTrackingId=<script>alert(1)</script>`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/text\/html/);
      const html = await res.text();
      expect(html).not.toContain("alert(1)");
      expect(html).not.toContain("OrderTrackingId");
    });
  });

  it("dismiss and restore: a person closes a payment with a reason; nothing is deleted or re-statused", async () => {
    const id = await confirmed(owner, "1234", "DISMISSPS01");
    const url = `/integrations/pesapal/payment-requests/${id}`;
    expect((await call("POST", `${url}/dismiss`, owner, { note: "ok" })).status).toBe(400);
    expect((await call("POST", `${url}/dismiss`, cashier, { note: "Refunded in Pesapal, ref 123" })).status).toBe(403);
    expect((await call("POST", `${url}/dismiss`, other, { note: "Refunded in Pesapal, ref 123" })).status).toBe(404);
    const d = await call("POST", `${url}/dismiss`, owner, { note: "Refunded in Pesapal, ref 123" });
    expect(d.status, JSON.stringify(d.body)).toBe(200);
    expect((await call("POST", `${url}/dismiss`, owner, { note: "Refunded in Pesapal, ref 123" })).status).toBe(409);
    let list = (await call("GET", "/integrations/pesapal/attention", owner)).body.data;
    expect(list.unlinked.map((x: any) => x.id)).not.toContain(id);
    const shown = list.dismissed.find((x: any) => x.id === id);
    expect(shown.dismissedNote).toBe("Refunded in Pesapal, ref 123");
    expect(shown.dismissedBy).toBeTruthy();
    const [row] = await query<{ status: string }>(`select status from pesapal_payment_requests where public_id = $1::uuid`, [id]);
    expect(row!.status).toBe("paid");
    expect((await call("POST", `${url}/restore`, cashier)).status).toBe(403);
    expect((await call("POST", `${url}/restore`, owner)).status).toBe(200);
    list = (await call("GET", "/integrations/pesapal/attention", owner)).body.data;
    expect(list.unlinked.map((x: any) => x.id)).toContain(id);
    expect(list.dismissed.map((x: any) => x.id)).not.toContain(id);
    // a pending request is not "needing attention": it cannot be dismissed
    const pend = await create(owner, { amount: "100" });
    expect((await call("POST", `/integrations/pesapal/payment-requests/${pend.body.data.id}/dismiss`, owner, { note: "Not needed anymore" })).status).toBe(409);
  });

  it("is isolated between businesses", async () => {
    const mine = await create(owner, { amount: "330" });
    expect((await get(other, mine.body.data.id)).status).toBe(404);
    const list = await call("GET", "/integrations/pesapal/attention", other);
    expect(JSON.stringify(list.body)).not.toContain(mine.body.data.id);
  });

  describe("sale linking", () => {
    let product: string;
    const sale = (t: Tenant, qty: number, over: Record<string, unknown> = {}) =>
      call("POST", "/sales", t, { amountPaid: qty * 1000, paymentMethod: "pesapal", items: [{ productId: product, quantity: qty, unitPrice: 1000 }], ...over });
    const salesCount = async () => Number((await query<{ c: string }>(`select count(*) c from sales where business_id = $1`, [owner.businessId]))[0]!.c);
    beforeAll(async () => { product = (await createProduct(owner, { name: "Psp Item", costPrice: 100, sellingPrice: 1000, stockQuantity: 500 })).id; });

    it("a confirmed payment becomes the sale's payment under the Pesapal method, with its confirmation code", async () => {
      const id = await confirmed(owner, "2000", "LINKPSP0001");
      const r = await sale(owner, 2, { pesapalPaymentRequestId: id });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      const pays = await query<{ method: string; reference: string; amount: string }>(
        `select p.method, p.reference, p.amount::text from payments p join sales s on s.id = p.sale_id where s.public_id = $1::uuid`, [r.body.data.id]);
      expect(pays).toEqual([{ method: "pesapal", reference: "LINKPSP0001", amount: "2000.00" }]);
      const [l] = await query<{ ok: boolean }>(`select (sale_id = (select id from sales where public_id = $1::uuid)) ok from pesapal_payment_requests where public_id = $2::uuid`, [r.body.data.id, id]);
      expect(l!.ok).toBe(true);
    });

    it("the same confirmed payment cannot be spent twice, not even at the same moment", async () => {
      const id = await confirmed(owner, "1000", "RACEPSP0001");
      const before = await salesCount();
      const results = await Promise.all([1, 2, 3].map(() => sale(owner, 1, { pesapalPaymentRequestId: id })));
      expect(results.filter((x) => x.status === 201).length).toBe(1);
      expect(results.filter((x) => x.status === 409).length).toBe(2);
      expect(await salesCount()).toBe(before + 1);
    });

    it("refuses unconfirmed, mismatched, wrong-method, double-id, foreign, reversed or malformed payments and creates no sale", async () => {
      const before = await salesCount();
      const pending = await create(owner, { amount: "1000" });
      const pr = await sale(owner, 1, { pesapalPaymentRequestId: pending.body.data.id });
      expect(pr.status).toBe(409);
      expect(pr.body.message).toMatch(/not been confirmed/);

      const paid = await confirmed(owner, "1000", "MISMATCHPS1");
      expect((await sale(owner, 2, { pesapalPaymentRequestId: paid })).body.message).toMatch(/exactly that/);
      expect((await sale(owner, 1, { pesapalPaymentRequestId: paid, paymentMethod: "cash" })).status).toBe(400);
      expect((await sale(owner, 1, { pesapalPaymentRequestId: paid, mpesaPaymentRequestId: paid })).status).toBe(400);
      expect((await sale(owner, 1, { pesapalPaymentRequestId: "not-a-uuid" })).status).toBe(400);
      expect((await sale(other, 1, { pesapalPaymentRequestId: paid })).status).toBe(404);

      const rev = await create(owner, { amount: "1000" });
      const o = lastOrder();
      completed(o, 1000, "REVERSEDPS1");
      await get(owner, rev.body.data.id);
      state.set(o.trackingId, { status_code: 3 });
      await get(owner, rev.body.data.id);
      const rr = await sale(owner, 1, { pesapalPaymentRequestId: rev.body.data.id });
      expect(rr.status).toBe(409);
      expect(rr.body.message).toMatch(/reversed/);
      expect(await salesCount()).toBe(before);
    });

    it("a paid but unused payment shows up on the attention list", async () => {
      const id = await confirmed(owner, "1111", "UNUSEDPSP01");
      const list = await call("GET", "/integrations/pesapal/attention", owner);
      expect(list.body.data.unlinked.map((x: any) => x.id)).toContain(id);
      expect((await call("GET", "/integrations/pesapal/attention", nobody)).status).toBe(403);
    });
  });

  describe("the database enforces the same rules", () => {
    const row = async () => (await query<{ id: string }>(`select id::text from pesapal_payment_requests where status = 'pending' order by id limit 1`))[0]!.id;
    it("only a paid request can be linked to a sale", async () => {
      const [s] = await query<{ id: string }>(`select id::text from sales where business_id = $1 limit 1`, [owner.businessId]);
      await expect(query(`update pesapal_payment_requests set sale_id = $1 where id = $2`, [s!.id, await row()])).rejects.toThrow(/only a paid Pesapal request/);
    });
    it("a paid request cannot link to another business's sale", async () => {
      const op = (await createProduct(other, { name: "Other Item", costPrice: 1, sellingPrice: 10, stockQuantity: 5 })).id;
      expect((await call("POST", "/sales", other, { amountPaid: 10, paymentMethod: "cash", items: [{ productId: op, quantity: 1, unitPrice: 10 }] })).status).toBe(201);
      const [paid] = await query<{ id: string }>(`select id::text from pesapal_payment_requests where business_id = $1 and status = 'paid' and sale_id is null limit 1`, [owner.businessId]);
      const otherSale = await query<{ id: string }>(`select id::text from sales where business_id = $1 limit 1`, [other.businessId]);
      expect(otherSale[0]).toBeTruthy();
      await expect(query(`update pesapal_payment_requests set sale_id = $1 where id = $2`, [otherSale[0]!.id, paid!.id])).rejects.toThrow(/different businesses/);
    });
    it("rejects bad statuses, non-positive amounts, no contact, and a reused confirmation code", async () => {
      const id = await row();
      await expect(query(`update pesapal_payment_requests set status = 'refunded' where id = $1`, [id])).rejects.toThrow(/status_check/);
      await expect(query(`update pesapal_payment_requests set amount_cents = 0 where id = $1`, [id])).rejects.toThrow(/amount_positive/);
      await expect(query(`update pesapal_payment_requests set customer_phone = null, customer_email = null where id = $1`, [id])).rejects.toThrow(/contact_present/);
      await expect(query(`update pesapal_payment_requests set status = 'paid' where id = $1`, [id])).rejects.toThrow(/paid_complete/);
      await expect(query(`update pesapal_payment_requests set confirmation_code = 'LINKPSP0001' where id = $1 and business_id = $2`, [id, owner.businessId])).rejects.toThrow(/code_per_business/);
    });
  });
});
