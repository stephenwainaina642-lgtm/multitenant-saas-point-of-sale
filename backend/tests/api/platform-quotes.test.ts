import { describe, it, expect, beforeAll } from "vitest";
import bcrypt from "bcryptjs";
import { query, resetData } from "../support/db.js";
import { loadTestConfig } from "../support/env.js";
import { api } from "../support/http.js";
import { registerTenant } from "../support/seed.js";
import { encryptSecret, newTotpSecret, stepAt, totpAt } from "../../src/platform/totp.js";

process.env.JWT_SECRET = loadTestConfig().jwtSecret;
const PW = "Platform-Admin-Pass-1";

describe("super admin quotations", () => {
  let token = "";
  let shopToken: { token: string; businessId: string; businessPublicId?: string };
  const s = (t = token) => ({ token: t } as any);
  const get = (p: string) => api("GET", `/platform${p}`, { session: s() });
  const post = (p: string, body: unknown = {}) => api("POST", `/platform${p}`, { session: s(), body });
  const put = (p: string, body: unknown) => api("PUT", `/platform${p}`, { session: s(), body });
  const del = (p: string) => api("DELETE", `/platform${p}`, { session: s() });
  const line = (description: string, quantity: number, unitPrice: number, category = "installation") => ({ category, description, quantity, unitPrice });
  const base = (over: Record<string, unknown> = {}) => ({ clientName: "Mama Njeri", clientBusiness: "Njeri Grand Hotel", clientEmail: "njeri@example.com", title: "POS installation", items: [line("On-site installation", 1, 15000), line("Staff training (per day)", 2, 5000, "training")], ...over });
  const issue = async (over: Record<string, unknown> = {}) => {
    const q = await post("/quotes", base(over));
    expect(q.status, JSON.stringify(q.body)).toBe(201);
    return q.body.data;
  };

  beforeAll(async () => {
    await resetData();
    const secret = newTotpSecret();
    await query(`insert into platform_admins(name, email, password_hash, totp_secret_enc) values ('Boss', 'boss@nexa.test', $1, $2)`, [await bcrypt.hash(PW, 4), encryptSecret(secret)]);
    const r = await api("POST", "/platform/login", { body: { email: "boss@nexa.test", password: PW, code: totpAt(secret, stepAt(Date.now())) } });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    token = r.body.data.token;
    shopToken = await registerTenant("Some Shop");
  }, 60_000);

  it("is only for platform admins: business users and anonymous callers are refused", async () => {
    for (const path of ["/quotes", "/quote-settings", "/quote-services"]) {
      expect((await api("GET", `/platform${path}`, { session: shopToken })).status, path).toBe(401);
      expect((await api("GET", `/platform${path}`)).status, path).toBe(401);
    }
    expect((await api("POST", "/platform/quotes", { session: shopToken, body: base() })).status).toBe(401);
  });

  it("works out totals in whole cents on the server, ignoring any totals the browser sends", async () => {
    const q = await issue({ discount: 1000, vatRate: 16, subtotal: 1, total: 1, items: [line("Install", 1, 15000), line("Training", 2.5, 4999.99, "training")] });
    // 15000 + 12499.975 -> 12499.98 (half up) = 27499.98; less 1000 = 26499.98; VAT 16% = 4239.9968 -> 4240.00
    expect(q.subtotal).toBe("27499.98");
    expect(q.vatAmount).toBe("4240.00");
    expect(q.total).toBe("30739.98");
    expect(q.items.map((i: any) => i.lineTotal)).toEqual(["15000.00", "12499.98"]);
    expect(q.status).toBe("draft");
    expect(q.number).toMatch(/^QT-\d{4}-\d{4}$/);
  });

  it("numbers quotations in order with no gaps or repeats, even when created at the same moment", async () => {
    const made = await Promise.all([1, 2, 3, 4, 5].map(() => issue()));
    const nums = made.map((m) => Number(m.number.slice(-4))).sort((a, b) => a - b);
    expect(new Set(nums).size).toBe(5);
    expect(nums[4]! - nums[0]!).toBe(4);
  });

  it("refuses bad input", async () => {
    const bad: [string, Record<string, unknown>][] = [
      ["no client", base({ clientName: "  " })],
      ["bad email", base({ clientEmail: "nope" })],
      ["zero quantity", base({ items: [line("x", 0, 10)] })],
      ["negative price", base({ items: [line("x", 1, -10)] })],
      ["3-decimal quantity", base({ items: [line("x", 1.005, 10)] })],
      ["sub-cent price", base({ items: [line("x", 1, 10.005)] })],
      ["blank description", base({ items: [line(" ", 1, 10)] })],
      ["bad category", base({ items: [{ ...line("x", 1, 10), category: "magic" }] })],
      ["vat too high", base({ vatRate: 60 })],
      ["vat text", base({ vatRate: "abc" })],
      ["discount over subtotal", base({ discount: 999999 })],
      ["negative discount", base({ discount: -1 })],
      ["bad date", base({ validUntil: "2026-02-31" })],
      ["too many lines", base({ items: Array.from({ length: 51 }, (_, i) => line(`L${i}`, 1, 1)) })],
      ["items not a list", base({ items: "x" })],
    ];
    for (const [label, body] of bad) expect((await post("/quotes", body)).status, label).toBe(400);
  });

  it("a draft can be edited (lines replaced, total recalculated); a sent quote cannot until reopened", async () => {
    const q = await issue();
    const edited = await put(`/quotes/${q.id}`, { ...base(), items: [line("Only one", 3, 1000)], vatRate: 0 });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    expect(edited.body.data.total).toBe("3000.00");
    expect(edited.body.data.items).toHaveLength(1);
    expect((await put(`/quotes/${q.id}`, { ...base(), clientName: "" })).status).toBe(400);
    expect((await get(`/quotes/${q.id}`)).body.data.total).toBe("3000.00"); // a refused edit changed nothing
    await put("/quote-settings", { companyName: "Nexa Systems" });
    expect((await post(`/quotes/${q.id}/send`)).status).toBe(200);
    expect((await put(`/quotes/${q.id}`, base())).status).toBe(409);
    expect((await del(`/quotes/${q.id}`)).status).toBe(409);
    const re = await post(`/quotes/${q.id}/reopen`);
    expect(re.body.data.status).toBe("draft");
    expect(re.body.data.issuerFrozen).toBe(false);
    expect((await put(`/quotes/${q.id}`, base())).status).toBe(200);
  });

  it("sending needs lines, a company name and a valid date; the company details are frozen on the quote", async () => {
    await query(`update platform_quote_settings set company_name = ''`);
    const q = await issue();
    expect((await post(`/quotes/${q.id}/send`)).status).toBe(400); // no company name yet
    await put("/quote-settings", { companyName: "Nexa Systems Ltd", phone: "0700 000 000", kraPin: "P000000000A" });
    const empty = await issue({ items: [] });
    expect((await post(`/quotes/${empty.id}/send`)).status).toBe(400);
    const old = await issue({ validUntil: "2020-01-01" });
    expect((await post(`/quotes/${old.id}/send`)).status).toBe(400);
    const sent = await post(`/quotes/${q.id}/send`);
    expect(sent.body.data.status).toBe("sent");
    expect(sent.body.data.issuerFrozen).toBe(true);
    await put("/quote-settings", { companyName: "Renamed Co" });
    expect((await get(`/quotes/${q.id}`)).body.data.issuer.companyName).toBe("Nexa Systems Ltd"); // issued quote unchanged
    expect((await issue()).issuer.companyName).toBe("Renamed Co"); // a new draft shows the live details
    await put("/quote-settings", { companyName: "Nexa Systems Ltd" });
  });

  it("a sent quote is accepted or declined once; decisions cannot be changed afterwards", async () => {
    const a = await issue(), d = await issue();
    await post(`/quotes/${a.id}/send`); await post(`/quotes/${d.id}/send`);
    expect((await post(`/quotes/${a.id}/accept`)).body.data.status).toBe("accepted");
    expect((await post(`/quotes/${d.id}/decline`)).body.data.status).toBe("declined");
    for (const act of ["accept", "decline", "reopen", "send"]) {
      expect((await post(`/quotes/${a.id}/${act}`)).status, act).toBe(409);
    }
    expect((await put(`/quotes/${a.id}`, base())).status).toBe(409);
    const draft = await issue();
    expect((await post(`/quotes/${draft.id}/accept`)).status).toBe(409); // never sent
  });

  it("an expired quote cannot be accepted, shows as expired, and a duplicate gives a fresh draft with a new number", async () => {
    const q = await issue();
    await post(`/quotes/${q.id}/send`);
    await query(`update platform_quotes set valid_until = current_date - 3 where public_id = $1::uuid`, [q.id]);
    expect((await get(`/quotes/${q.id}`)).body.data.expired).toBe(true);
    expect((await post(`/quotes/${q.id}/accept`)).status).toBe(409);
    const copy = await post(`/quotes/${q.id}/duplicate`);
    expect(copy.status).toBe(201);
    expect(copy.body.data.status).toBe("draft");
    expect(copy.body.data.number).not.toBe(q.number);
    expect(copy.body.data.total).toBe(q.total);
    expect(copy.body.data.expired).toBe(false);
  });

  it("only drafts can be deleted, and it is recorded", async () => {
    const q = await issue();
    expect((await del(`/quotes/${q.id}`)).status).toBe(200);
    expect((await get(`/quotes/${q.id}`)).status).toBe(404);
    expect((await del(`/quotes/00000000-0000-4000-8000-000000000000`)).status).toBe(404);
    expect((await get(`/quotes/not-an-id`)).status).toBe(400);
    const log = await query<{ c: string }>(`select count(*) c from platform_audit_logs where action = 'quote.delete'`);
    expect(Number(log[0]!.c)).toBeGreaterThanOrEqual(1);
  });

  it("lists with filters and search", async () => {
    await issue({ clientName: "Zebra Lodge Owner", clientBusiness: "Zebra Lodge" });
    const found = await get(`/quotes?q=zebra`);
    expect(found.body.data.length).toBeGreaterThanOrEqual(1);
    expect(found.body.data.every((r: any) => /zebra/i.test(r.clientName + r.clientBusiness))).toBe(true);
    const drafts = await get(`/quotes?status=draft`);
    expect(drafts.body.data.every((r: any) => r.status === "draft")).toBe(true);
    expect((await get(`/quotes?q=${"x".repeat(500)}`)).status).toBe(200);
  });

  it("settings: validated, and defaults flow into new quotes", async () => {
    for (const bad of [{ defaultVatRate: 70 }, { defaultValidityDays: 0 }, { defaultValidityDays: 1.5 }, { email: "no" }, {}]) {
      expect((await put("/quote-settings", bad)).status, JSON.stringify(bad)).toBe(400);
    }
    await put("/quote-settings", { defaultTerms: "50% deposit before installation.", paymentDetails: "Pay via Paybill 123456", defaultVatRate: 16, defaultValidityDays: 30 });
    const q = await post("/quotes", { clientName: "Defaults Test", items: [line("Item", 1, 100)] });
    expect(q.body.data.terms).toBe("50% deposit before installation.");
    expect(q.body.data.paymentDetails).toBe("Pay via Paybill 123456");
    expect(q.body.data.vatRate).toBe("16.00");
    expect(q.body.data.total).toBe("116.00");
    const days = (Date.parse(q.body.data.validUntil) - Date.parse(new Date().toISOString().slice(0, 10))) / 86400000;
    expect(days).toBeGreaterThanOrEqual(29);
    await put("/quote-settings", { defaultVatRate: 0, defaultValidityDays: 14 });
  });

  it("price list: add, edit, remove; names are unique; removing never changes an existing quote", async () => {
    const svc = await post("/quote-services", { name: "Standard installation", category: "installation", unitPrice: 12000, unit: "visit" });
    expect(svc.status, JSON.stringify(svc.body)).toBe(201);
    expect((await post("/quote-services", { name: "Standard installation", unitPrice: 1 })).status).toBe(409);
    for (const bad of [{ name: "" }, { name: "x", unitPrice: -1 }, { name: "x", category: "zzz" }, { name: "x", unitPrice: 1.234 }]) expect((await post("/quote-services", bad)).status, JSON.stringify(bad)).toBe(400);
    const upd = await put(`/quote-services/${svc.body.data.id}`, { unitPrice: 13500 });
    expect(upd.body.data.unitPrice).toBe("13500.00");
    const q = await issue({ items: [line(svc.body.data.name, 1, 13500)] });
    expect((await del(`/quote-services/${svc.body.data.id}`)).status).toBe(200);
    expect((await get(`/quotes/${q.id}`)).body.data.items[0].description).toBe("Standard installation");
    expect((await del(`/quote-services/${svc.body.data.id}`)).status).toBe(404);
  });

  it("every change is in the activity log, with no amounts needing to be trusted from the client", async () => {
    const q = await issue();
    await post(`/quotes/${q.id}/send`);
    const actions = await query<{ action: string }>(`select action from platform_audit_logs where reason = $1 order by id`, [`Quotation ${q.number}`]);
    expect(actions.map((a) => a.action)).toEqual(["quote.create", "quote.send"]);
  });

  it("database rules hold even if the code is bypassed", async () => {
    await expect(query(`update platform_quotes set status = 'sent' where status = 'draft' and id = (select min(id) from platform_quotes where status = 'draft')`)).rejects.toThrow(/issued_has_issuer/);
    await expect(query(`update platform_quotes set discount = subtotal + 1 where id = (select min(id) from platform_quotes)`)).rejects.toThrow(/discount_within_subtotal/);
    await expect(query(`update platform_quotes set status = 'maybe' where id = (select min(id) from platform_quotes where status = 'sent')`)).rejects.toThrow(/status_valid/);
    await expect(query(`update platform_quote_items set quantity = 0 where id = (select min(id) from platform_quote_items)`)).rejects.toThrow(/qty_positive/);
    await expect(query(`insert into platform_quote_settings(id) values (2)`)).rejects.toThrow(/single_row/);
  });
});
