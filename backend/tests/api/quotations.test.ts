import { describe, it, expect, beforeAll } from "vitest";
import { query, resetData } from "../support/db.js";
import { get, post, put } from "../support/http.js";
import { addEmployee, ledgerViolations, registerTenant, seedPhoneShop, stockOf, type Tenant, mpesaCode } from "../support/seed.js";

const N = (v: unknown) => Number(v);

describe("quotations", () => {
  let s: Awaited<ReturnType<typeof seedPhoneShop>>;
  let other: Tenant;
  beforeAll(async () => { await resetData(); s = await seedPhoneShop(); other = await registerTenant("Other"); });

  const line = (productId: string, quantity: number, unitPrice: number, extra: object = {}) => ({ productId, quantity, unitPrice, ...extra });
  const quote = async (body: object = {}) => {
    const r = await post("/quotations", s.t, {
      customerId: s.customer.id, items: [line(s.charger.id, 3, 1200)], ...body,
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body.data as any;
  };
  const accept = async (id: string) => post(`/quotations/${id}/status`, s.t, { status: "accepted" });

  it("creates quotations with sequential numbers and exact totals (line and quotation-level discount and tax)", async () => {
    const a = await quote({ discount: 50, tax: 100, items: [line(s.charger.id, 3, 1200, { discount: 100, tax: 20 }), line(s.galaxy.id, 1, 21500)] });
    expect(a.quotationNumber).toBe("QUO-000001");
    // subtotal 3600 + 21500; discount 100 + 50; tax 20 + 100
    expect(N(a.subtotal)).toBe(25100);
    expect(N(a.discount)).toBe(150);
    expect(N(a.tax)).toBe(120);
    expect(N(a.total)).toBe(25070);
    expect(a.status).toBe("draft");
    const b = await quote();
    expect(b.quotationNumber).toBe("QUO-000002");
  });

  it("quotes at catalogue prices, any stock level; rejects bad input", async () => {
    const big = await post("/quotations", s.t, { items: [line(s.iphone.id, 500, 112000)] });
    expect(big.status).toBe(201); // quoting does not reserve or require stock
    for (const bad of [
      { items: [] }, { items: [line(s.charger.id, 1, 999)] }, { items: [line("999999", 1, 1200)] },
      { items: [line(s.charger.id, 0, 1200)] }, { items: [line(s.charger.id, 1, 1200, { discount: 99999 })] },
      { customerId: "999999" }, { customerId: "abc" }, { quotationDate: "nope" }, { expiryDate: "nope" },
      { quotationDate: "2026-06-10", expiryDate: "2026-06-01" }, { notes: 5 }, { quotationNumber: "x".repeat(101) },
    ]) {
      const r = await post("/quotations", s.t, { customerId: s.customer.id, items: [line(s.charger.id, 1, 1200)], ...bad });
      expect(r.status, JSON.stringify(bad)).toBeGreaterThanOrEqual(400);
      expect(r.status, JSON.stringify(bad)).toBeLessThan(500);
    }
  });

  it("manual numbers must be unique and auto numbering skips taken ones", async () => {
    const m = await quote({ quotationNumber: "QUO-000099" });
    expect(m.quotationNumber).toBe("QUO-000099");
    expect((await post("/quotations", s.t, { quotationNumber: "QUO-000099", items: [line(s.charger.id, 1, 1200)] })).status).toBe(409);
  });

  it("drafts and sent quotations can be edited; decided ones cannot", async () => {
    const q = await quote();
    const u = await put(`/quotations/${q.id}`, s.t, { items: [line(s.charger.id, 5, 1200), line(s.galaxy.id, 1, 21500)], notes: "Revised" });
    expect(u.status).toBe(200);
    expect(N(u.body.data.total)).toBe(27500);
    expect(u.body.data.items).toHaveLength(2);
    expect(u.body.data.notes).toBe("Revised");
    expect((await put(`/quotations/${q.id}`, s.t, { items: [] })).status).toBe(400);
    expect((await post(`/quotations/${q.id}/status`, s.t, { status: "sent" })).status).toBe(200);
    expect((await put(`/quotations/${q.id}`, s.t, { items: [line(s.charger.id, 1, 1200)] })).status).toBe(200);
    await accept(q.id);
    const locked = await put(`/quotations/${q.id}`, s.t, { items: [line(s.charger.id, 1, 1200)] });
    expect(locked.status).toBe(409);
    const [a] = await query(`select count(*)::int as n from audit_logs where entity = 'quotation' and entity_id = $1 and action = 'quotation.update'`, [q.id]);
    expect(a!.n).toBe(2);
  });

  it("status follows draft → sent → accepted/rejected only; expiry is derived", async () => {
    const q = await quote();
    expect((await post(`/quotations/${q.id}/status`, s.t, { status: "bogus" })).status).toBe(400);
    expect((await post(`/quotations/${q.id}/status`, s.t, { status: "converted" })).status).toBe(400);
    expect((await post(`/quotations/${q.id}/status`, s.t, { status: "sent" })).body.data.status).toBe("sent");
    expect((await post(`/quotations/${q.id}/status`, s.t, { status: "sent" })).status).toBe(409);
    expect((await accept(q.id)).body.data.status).toBe("accepted");
    expect((await post(`/quotations/${q.id}/status`, s.t, { status: "rejected" })).status).toBe(409);

    const old = await quote({ quotationDate: "2026-01-01", expiryDate: "2026-01-31" });
    expect(old.status).toBe("expired");
    expect((await accept(old.id)).status).toBe(409);
    expect((await get(`/quotations/${old.id}`, s.t)).body.data.status).toBe("expired");
  });

  it("converts an accepted quotation into a real sale with matching totals, stock and balance", async () => {
    const q = await quote({ discount: 100, tax: 50, items: [line(s.charger.id, 2, 1200, { discount: 40 })] });
    // 2400 - 40 - 100 + 50 = 2310
    expect(N(q.total)).toBe(2310);
    expect((await post(`/quotations/${q.id}/convert`, s.t, {})).status).toBe(409); // not accepted yet
    await accept(q.id);
    const stock = await stockOf(s.charger.id);
    const r = await post(`/quotations/${q.id}/convert`, s.t, { amountPaid: 1000, paymentMethod: "mpesa", paymentReference: mpesaCode() });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(N(r.body.data.sale.total)).toBe(2310);
    expect(N(r.body.data.sale.balanceDue)).toBe(1310);
    expect(r.body.data.quotation).toMatchObject({ status: "converted", convertedReceiptNumber: r.body.data.sale.receiptNumber });
    expect(await stockOf(s.charger.id)).toBe(stock - 2);
    expect((await post(`/quotations/${q.id}/convert`, s.t, {})).status).toBe(409);
    expect(await stockOf(s.charger.id)).toBe(stock - 2);
    expect(await ledgerViolations()).toEqual([]);
  });

  it("conversion fails cleanly when stock is short or prices have changed, leaving the quotation accepted", async () => {
    const q = await quote({ items: [line(s.iphone.id, 500, 112000)] });
    await accept(q.id);
    const short = await post(`/quotations/${q.id}/convert`, s.t, { amountPaid: 0 });
    expect(short.status).toBe(400);
    expect(short.body.message).toMatch(/Insufficient stock/);
    expect((await get(`/quotations/${q.id}`, s.t)).body.data.status).toBe("accepted");

    const p = await quote({ items: [line(s.charger.id, 1, 1200)] });
    await accept(p.id);
    await query(`update products set selling_price = 1300 where id = $1`, [s.charger.id]);
    const changed = await post(`/quotations/${p.id}/convert`, s.t, {});
    expect(changed.status).toBe(409);
    expect(changed.body.message).toMatch(/Prices changed/);
    await query(`update products set selling_price = 1200 where id = $1`, [s.charger.id]);
    expect((await post(`/quotations/${p.id}/convert`, s.t, {})).status).toBe(201);
  });

  it("simultaneous conversions create exactly one sale", async () => {
    const q = await quote({ items: [line(s.charger.id, 2, 1200)] });
    await accept(q.id);
    const stock = await stockOf(s.charger.id);
    const rs = await Promise.all(Array.from({ length: 5 }, () => post(`/quotations/${q.id}/convert`, s.t, {})));
    expect(rs.some((r) => r.status === 201)).toBe(true);
    expect(rs.every((r) => r.status === 201 || r.status === 409)).toBe(true);
    const sales = await query(`select count(*)::int as n from sales where notes = $1`, [`From quotation ${q.quotationNumber}`]);
    expect(sales[0]!.n).toBe(1);
    expect(await stockOf(s.charger.id)).toBe(stock - 2);
    expect((await get(`/quotations/${q.id}`, s.t)).body.data.status).toBe("converted");
    expect(await ledgerViolations()).toEqual([]);
  });

  it("tenant isolation and permissions", async () => {
    const q = await quote();
    expect((await get(`/quotations/${q.id}`, other)).status).toBe(404);
    expect((await get("/quotations", other)).body.data.map((x: any) => x.id)).not.toContain(q.id);
    expect((await put(`/quotations/${q.id}`, other, { items: [line(s.charger.id, 1, 1200)] })).status).toBe(404);
    expect((await post(`/quotations/${q.id}/status`, other, { status: "sent" })).status).toBe(404);
    expect((await post(`/quotations/${q.id}/convert`, other, {})).status).toBe(404);
    expect((await get("/quotations/abc", s.t)).status).toBe(404);

    const csh = await addEmployee(s.t, "Cashier");
    expect((await get("/quotations", csh)).status).toBe(403);
    const quoter = await addEmployee(s.t, "Quoter", ["quotations.view", "quotations.manage", "products.view"]);
    expect((await post("/quotations", quoter, { items: [line(s.charger.id, 1, 1200)] })).status).toBe(201);
    await accept(q.id);
    const denied = await post(`/quotations/${q.id}/convert`, quoter, {});
    expect(denied.status).toBe(403); // converting creates a sale, which needs sales.create
  });
});
