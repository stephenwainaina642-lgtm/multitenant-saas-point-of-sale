import { describe, it, expect, beforeAll } from "vitest";
import bcrypt from "bcryptjs";
import { query, resetData } from "../support/db.js";
import { loadTestConfig } from "../support/env.js";
import { api, get, post } from "../support/http.js";
import { addEmployee, createProduct, registerTenant } from "../support/seed.js";
import { encryptSecret, newTotpSecret, stepAt, totpAt } from "../../src/platform/totp.js";
import { effectiveStatus, nextPeriodEnd, addMonths } from "../../src/lib/subscription.js";

process.env.JWT_SECRET = loadTestConfig().jwtSecret;
const PW = "Platform-Admin-Pass-1";
const DAY = 86_400_000;

describe("subscription rules (pure)", () => {
  const d = (s: string) => new Date(s);
  it("has no subscription -> never restricted (legacy)", () => expect(effectiveStatus(null)).toBeNull());
  it("moves active -> grace -> expired by the dates alone", () => {
    const sub = { status: "active", currentPeriodEnd: d("2026-01-10T00:00:00Z"), graceDays: 7 };
    expect(effectiveStatus(sub, d("2026-01-09T00:00:00Z"))).toMatchObject({ status: "active", restricted: false });
    expect(effectiveStatus(sub, d("2026-01-12T00:00:00Z"))).toMatchObject({ status: "grace", restricted: false });
    expect(effectiveStatus(sub, d("2026-01-18T00:00:00Z"))).toMatchObject({ status: "expired", restricted: true });
  });
  it("suspended and pending payment are restricted whatever the dates; cancelled works until its period ends", () => {
    expect(effectiveStatus({ status: "suspended", currentPeriodEnd: d("2099-01-01"), graceDays: 7 })!.restricted).toBe(true);
    expect(effectiveStatus({ status: "pending_payment", currentPeriodEnd: null, graceDays: 7 })!.restricted).toBe(true);
    const c = { status: "cancelled", currentPeriodEnd: d("2026-01-10T00:00:00Z"), graceDays: 30 };
    expect(effectiveStatus(c, d("2026-01-05T00:00:00Z"))!.restricted).toBe(false);
    expect(effectiveStatus(c, d("2026-01-11T00:00:00Z"))!.restricted).toBe(true); // no grace after a cancellation
  });
  it("adds calendar months without overflowing, and early renewal keeps the days left", () => {
    expect(addMonths(d("2026-01-31T00:00:00Z"), 1).toISOString()).toBe("2026-02-28T00:00:00.000Z");
    const now = d("2026-03-01T00:00:00Z");
    expect(nextPeriodEnd("monthly", d("2026-03-20T00:00:00Z"), 1, now).to!.toISOString()).toBe("2026-04-20T00:00:00.000Z");
    expect(nextPeriodEnd("annual", d("2026-02-01T00:00:00Z"), 1, now).to!.toISOString()).toBe("2027-03-01T00:00:00.000Z");
    expect(nextPeriodEnd("one_time", null, 1, now).to).toBeNull();
  });
});

describe("plans, subscriptions and manual payments", () => {
  let token: string;
  let shop: Awaited<ReturnType<typeof registerTenant>>;
  let other: Awaited<ReturnType<typeof registerTenant>>;
  let worker: Awaited<ReturnType<typeof addEmployee>>;
  let planId: string;
  const bearer = (t: string) => ({ token: t }) as any;
  const A = (method: string, path: string, body?: unknown) => api(method, `/platform${path}`, { session: bearer(token), ...(body !== undefined ? { body } : {}) });
  const sub = async (t = shop) => (await A("GET", `/businesses/${t.businessPublicId}/subscription`)).body.data;
  const setEnd = (t: typeof shop, iso: string) => query(`update platform_subscriptions set current_period_end = $2 where business_id = $1`, [t.businessId, iso]);

  beforeAll(async () => {
    await resetData();
    const secret = newTotpSecret();
    await query(`insert into platform_admins(name, email, password_hash, totp_secret_enc) values ('Boss', 'boss@nexa.test', $1, $2)`, [await bcrypt.hash(PW, 4), encryptSecret(secret)]);
    shop = await registerTenant("Sub Shop");
    other = await registerTenant("Other Shop");
    worker = await addEmployee(shop, "cashier");
    const login = await api("POST", "/platform/login", { body: { email: "boss@nexa.test", password: PW, code: totpAt(secret, stepAt(Date.now())) } });
    expect(login.status, JSON.stringify(login.body)).toBe(200);
    token = login.body.data.token;
  }, 90_000);

  it("is for platform admins only", async () => {
    expect((await api("GET", "/platform/plans")).status).toBe(401);
    expect((await api("GET", "/platform/payments", { session: { token: shop.token } })).status).toBe(401);
  });

  it("a business with no subscription (legacy) is unlimited and never restricted", async () => {
    expect((await sub()).legacy).toBe(true);
    expect((await post("/products", shop, { name: "Legacy item", costPrice: 1, sellingPrice: 2, stockQuantity: 1 })).status).toBe(201);
    expect((await get("/billing", shop)).body.data.legacy).toBe(true);
  });

  it("creates, validates, edits and archives plans; a plan in use cannot be deleted", async () => {
    expect((await A("POST", "/plans", { name: "Bad", monthlyPrice: -5 })).status).toBe(400);
    expect((await A("POST", "/plans", { name: "Bad", modules: ["nope"] })).status).toBe(400);
    const r = await A("POST", "/plans", { name: "Starter", monthlyPrice: 2000, annualPrice: 20000, discountPercent: 10, trialDays: 14, graceDays: 5, maxEmployees: 3, maxBranches: 2, modules: ["purchasing"] });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    planId = r.body.data.id;
    expect(r.body.data.code).toBe("starter");
    expect((await A("POST", "/plans", { name: "Starter", monthlyPrice: 1 })).status).toBe(409);
    const u = await A("PUT", `/plans/${planId}`, { monthlyPrice: 2500 });
    expect(u.body.data.monthlyPrice).toBe(2500);
    const spare = (await A("POST", "/plans", { name: "Spare" })).body.data.id;
    expect((await A("POST", `/plans/${spare}/archive`)).body.data.archived).toBe(true);
    expect((await A("DELETE", `/plans/${spare}`)).status).toBe(200); // never used
    expect((await A("GET", "/plans")).body.data.some((p: any) => p.id === spare)).toBe(false);
  });

  it("assigning needs a reason and a start mode; a trial uses the plan's days; plan modules become the business's modules", async () => {
    const id = shop.businessPublicId;
    expect((await A("POST", `/businesses/${id}/subscription`, { planId, billingCycle: "monthly", mode: "trial" })).status).toBe(400); // no reason
    expect((await A("POST", `/businesses/${id}/subscription`, { planId, billingCycle: "monthly", reason: "x1" })).status).toBe(400); // short reason
    expect((await A("POST", `/businesses/${id}/subscription`, { planId, billingCycle: "monthly", reason: "Sold it" })).status).toBe(400); // no mode
    const r = await A("POST", `/businesses/${id}/subscription`, { planId, billingCycle: "monthly", mode: "trial", reason: "Sold the Starter plan" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data).toMatchObject({ status: "trial", restricted: false, agreedPrice: 2250, maxEmployees: 3, maxBranches: 2, graceDays: 5 }); // 2500 less 10%
    expect(Math.round(r.body.data.daysLeft)).toBe(14);
    const m = await query<{ modules: string[] }>(`select modules from businesses where id = $1`, [shop.businessId]);
    expect(m[0]!.modules).toEqual(["purchasing"]);
    expect((await get("/billing", shop)).body.data.subscription.status).toBe("trial");
  });

  it("an archived plan cannot be assigned, and editing a plan does not change an existing customer", async () => {
    const p2 = (await A("POST", "/plans", { name: "Old", monthlyPrice: 1 })).body.data.id;
    await A("POST", `/plans/${p2}/archive`);
    expect((await A("POST", `/businesses/${other.businessPublicId}/subscription`, { planId: p2, mode: "pending", reason: "test" })).status).toBe(409);
    await A("PUT", `/plans/${planId}`, { maxEmployees: 50, monthlyPrice: 9999 });
    const s = (await sub()).subscription;
    expect(s.maxEmployees).toBe(3);
    expect(s.agreedPrice).toBe(2250);
    await A("PUT", `/plans/${planId}`, { maxEmployees: 3, monthlyPrice: 2500 });
  });

  it("enforces the staff and branch limits on the server", async () => {
    // owner + cashier = 2 of 3
    await addEmployee(shop, "cashier");
    const over = await post("/employees", shop, { name: "One Too Many", email: `x${Date.now()}@example.com`, phone: "0712345678", roleName: "cashier" });
    expect(over.status).toBe(403);
    expect(over.body.message).toMatch(/allows 3 people/);
    const inv = await post("/employees/invites", shop, { name: "Link Person", email: `l${Date.now()}@example.com`, roleName: "cashier" });
    expect(inv.status).toBe(403);
    // branches: Main exists, limit 2
    expect((await post("/branches", shop, { name: "Second" })).status).toBe(201);
    const b3 = await post("/branches", shop, { name: "Third" });
    expect(b3.status).toBe(403);
    expect(b3.body.message).toMatch(/allows 2 branches/);
    // raising the limit for this customer lets them add again
    expect((await A("PUT", `/businesses/${shop.businessPublicId}/subscription`, { maxEmployees: 10, reason: "Upgrade" })).status).toBe(200);
    expect((await post("/employees", shop, { name: "Fits Now", email: `y${Date.now()}@example.com`, phone: "0712345679", roleName: "cashier" })).status).toBe(201);
  });

  it("pending payment restricts changes but never reading; billing stays open; other businesses are untouched", async () => {
    const id = other.businessPublicId;
    const plan = (await A("POST", "/plans", { name: "Pro", monthlyPrice: 5000 })).body.data.id;
    await A("POST", `/businesses/${id}/subscription`, { planId: plan, billingCycle: "monthly", mode: "pending", reason: "Awaiting payment" });
    const w = await post("/products", other, { name: "Blocked", costPrice: 1, sellingPrice: 2, stockQuantity: 1 });
    expect(w.status).toBe(402);
    expect(w.body.code).toBe("SUBSCRIPTION_RESTRICTED");
    expect((await get("/products", other)).status).toBe(200);
    const b = await get("/billing", other);
    expect(b.status).toBe(200);
    expect(b.body.data.subscription).toMatchObject({ status: "pending_payment", restricted: true });
    expect((await post("/products", shop, { name: "Fine", costPrice: 1, sellingPrice: 2, stockQuantity: 1 })).status).toBe(201);
  });

  it("only the owner sees billing, and only their own", async () => {
    expect((await get("/billing", worker)).status).toBe(403);
    const mine = (await get("/billing", shop)).body.data;
    const theirs = (await get("/billing", other)).body.data;
    expect(mine.subscription.planName).toBe("Starter");
    expect(theirs.subscription.planName).toBe("Pro");
  });

  it("a recorded payment counts for nothing until approved; approving activates, dates the period and issues a receipt", async () => {
    const id = other.businessPublicId;
    expect((await A("POST", `/businesses/${id}/payments`, { amount: 5000, method: "bank" })).status).toBe(400); // bank needs a reference
    expect((await A("POST", `/businesses/${id}/payments`, { amount: 0, method: "cash" })).status).toBe(400);
    const rec = await A("POST", `/businesses/${id}/payments`, { amount: 5000, method: "mpesa", reference: "qa12bc34de", note: "Paybill statement" });
    expect(rec.status, JSON.stringify(rec.body)).toBe(201);
    expect(rec.body.data).toMatchObject({ status: "pending", reference: "QA12BC34DE", expectedAmount: 5000, receiptNo: null });
    expect((await sub(other)).subscription.status).toBe("pending_payment");
    expect((await post("/products", other, { name: "Still blocked", costPrice: 1, sellingPrice: 2, stockQuantity: 1 })).status).toBe(402);
    expect((await A("POST", `/businesses/${id}/payments`, { amount: 5000, method: "mpesa", reference: "QA12BC34DE" })).status).toBe(409); // same reference twice

    expect((await A("POST", `/payments/${rec.body.data.id}/approve`, {})).status).toBe(400); // reason needed
    const ok = await A("POST", `/payments/${rec.body.data.id}/approve`, { reason: "Seen on the statement" });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.data.payment.receiptNo).toMatch(/^RCT-\d{4}-\d{6}$/);
    expect(ok.body.data.subscription).toMatchObject({ status: "active", restricted: false });
    const end = new Date(ok.body.data.subscription.currentPeriodEnd).getTime();
    expect(end - Date.now()).toBeGreaterThan(27 * DAY);
    expect(end - Date.now()).toBeLessThan(32 * DAY);
    expect((await post("/products", other, { name: "Works now", costPrice: 1, sellingPrice: 2, stockQuantity: 1 })).status).toBe(201);

    // a second approval (double click, retry) changes nothing
    const again = await A("POST", `/payments/${rec.body.data.id}/approve`, { reason: "Retry" });
    expect(again.status).toBe(409);
    expect(new Date((await sub(other)).subscription.currentPeriodEnd).getTime()).toBe(end);
    const hist = (await sub(other)).history.map((h: any) => h.event);
    expect(hist.filter((e: string) => e === "payment_approved")).toHaveLength(1);
    expect((await A("GET", "/payments?status=approved")).body.data.some((p: any) => p.id === rec.body.data.id)).toBe(true);
  });

  it("two payments approved at the same moment each add their own month (no lost update)", async () => {
    const id = other.businessPublicId;
    const before = new Date((await sub(other)).subscription.currentPeriodEnd).getTime();
    const p1 = (await A("POST", `/businesses/${id}/payments`, { amount: 5000, method: "cash" })).body.data.id;
    const p2 = (await A("POST", `/businesses/${id}/payments`, { amount: 5000, method: "cash" })).body.data.id;
    const rs = await Promise.all([A("POST", `/payments/${p1}/approve`, { reason: "Cash in hand" }), A("POST", `/payments/${p2}/approve`, { reason: "Cash in hand" })]);
    expect(rs.map((r) => r.status)).toEqual([200, 200]);
    const after = new Date((await sub(other)).subscription.currentPeriodEnd).getTime();
    expect(after - before).toBeGreaterThan(55 * DAY);
  });

  it("rejecting leaves the subscription alone and frees the reference; refunding marks it without taking time away", async () => {
    const id = other.businessPublicId;
    const p = (await A("POST", `/businesses/${id}/payments`, { amount: 100, method: "bank", reference: "REF-REJ-1" })).body.data.id;
    const before = (await sub(other)).subscription.currentPeriodEnd;
    expect((await A("POST", `/payments/${p}/reject`, { reason: "Not on the statement" })).body.data.status).toBe("rejected");
    expect((await sub(other)).subscription.currentPeriodEnd).toBe(before);
    expect((await A("POST", `/payments/${p}/approve`, { reason: "oops" })).status).toBe(409); // already decided
    expect((await A("POST", `/businesses/${id}/payments`, { amount: 100, method: "bank", reference: "REF-REJ-1" })).status).toBe(201); // reference is free again
    const approved = (await A("GET", "/payments?status=approved")).body.data[0];
    expect((await A("POST", `/payments/${approved.id}/refund`, { reason: "Gave the money back" })).body.data.status).toBe("refunded");
    expect((await sub(other)).subscription.currentPeriodEnd).toBe(before); // time is not removed automatically
  });

  it("grace period keeps working; after it, changes are blocked but reading and exporting still work; paying restores access", async () => {
    await A("POST", `/businesses/${shop.businessPublicId}/payments`, { amount: 2250, method: "cash" }).then((r) => A("POST", `/payments/${r.body.data.id}/approve`, { reason: "Paid cash" }));
    expect((await sub()).subscription.status).toBe("active");
    await setEnd(shop, new Date(Date.now() - 2 * DAY).toISOString()); // grace is 5 days
    expect((await sub()).subscription).toMatchObject({ status: "grace", restricted: false });
    expect((await post("/products", shop, { name: "In grace", costPrice: 1, sellingPrice: 2, stockQuantity: 1 })).status).toBe(201);
    await setEnd(shop, new Date(Date.now() - 9 * DAY).toISOString());
    expect((await sub()).subscription).toMatchObject({ status: "expired", restricted: true });
    const blocked = await post("/products", shop, { name: "Expired", costPrice: 1, sellingPrice: 2, stockQuantity: 1 });
    expect(blocked.status).toBe(402);
    expect(blocked.body.message).toMatch(/view and export/);
    expect((await get("/products", shop)).status).toBe(200);
    expect((await get("/billing", shop)).status).toBe(200);
    const pay = await A("POST", `/businesses/${shop.businessPublicId}/payments`, { amount: 2250, method: "cash" });
    const ok = await A("POST", `/payments/${pay.body.data.id}/approve`, { reason: "Renewed in cash" });
    expect(ok.body.data.subscription).toMatchObject({ status: "active", restricted: false });
    expect((await post("/products", shop, { name: "Back", costPrice: 1, sellingPrice: 2, stockQuantity: 1 })).status).toBe(201);
    expect((await get("/products", shop)).body.data.some((p: any) => p.name === "Legacy item")).toBe(true); // nothing was deleted
  });

  it("suspend blocks changes; a payment does not lift a suspension; reactivate and extend need a reason", async () => {
    const id = shop.businessPublicId;
    expect((await A("POST", `/businesses/${id}/subscription/suspend`, {})).status).toBe(400);
    expect((await A("POST", `/businesses/${id}/subscription/suspend`, { reason: "Chargeback" })).body.data.status).toBe("suspended");
    expect((await post("/products", shop, { name: "Nope", costPrice: 1, sellingPrice: 2, stockQuantity: 1 })).status).toBe(402);
    const pay = await A("POST", `/businesses/${id}/payments`, { amount: 2250, method: "cash" });
    const ok = await A("POST", `/payments/${pay.body.data.id}/approve`, { reason: "Cash" });
    expect(ok.body.data.stayedSuspended).toBe(true);
    expect(ok.body.data.subscription.status).toBe("suspended");
    expect((await A("POST", `/businesses/${id}/subscription/reactivate`, { reason: "Resolved" })).body.data.status).toBe("active");
    const ext = await A("POST", `/businesses/${id}/subscription/extend`, { days: 10, reason: "Goodwill" });
    expect(ext.status).toBe(200);
    expect((await A("POST", `/businesses/${id}/subscription/cancel`, { reason: "Leaving" })).body.data.status).toBe("cancelled");
    expect((await post("/products", shop, { name: "Still paid", costPrice: 1, sellingPrice: 2, stockQuantity: 1 })).status).toBe(201); // works until the paid period ends
  });

  it("a complimentary grant is active at no price and is logged", async () => {
    const t = await registerTenant("Free Shop");
    const plan = (await A("GET", "/plans")).body.data[0].id;
    const r = await A("POST", `/businesses/${t.businessPublicId}/subscription`, { planId: plan, mode: "complimentary", reason: "Friend of the house" });
    expect(r.body.data).toMatchObject({ status: "active", agreedPrice: 0, restricted: false });
    const audit = (await A("GET", "/audit")).body.data;
    expect(JSON.stringify(audit)).toContain("subscription.assign");
  });

  it("erasing a business keeps the platform's payment record", async () => {
    const t = await registerTenant("Erase Me");
    const plan = (await A("GET", "/plans")).body.data[0].id;
    await A("POST", `/businesses/${t.businessPublicId}/subscription`, { planId: plan, billingCycle: "monthly", mode: "pending", agreedPrice: 1000, reason: "Setup" });
    const p = await A("POST", `/businesses/${t.businessPublicId}/payments`, { amount: 1000, method: "cash" });
    await A("POST", `/payments/${p.body.data.id}/approve`, { reason: "Cash" });
    await A("POST", `/businesses/${t.businessPublicId}/delete`, { reason: "Closing" });
    expect((await A("POST", `/businesses/${t.businessPublicId}/erase`, { reason: "Customer left", confirmName: "Erase Me" })).status).toBe(200);
    const left = await query<{ n: number }>(`select count(*)::int as n from platform_payments where business_id = $1`, [t.businessId]);
    expect(left[0]!.n).toBe(1);
    const subs = await query<{ n: number }>(`select count(*)::int as n from platform_subscriptions where business_id = $1`, [t.businessId]);
    expect(subs[0]!.n).toBe(0);
  });
});
