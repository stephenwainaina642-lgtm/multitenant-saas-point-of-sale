import { describe, it, expect, beforeAll } from "vitest";
import { query, resetData } from "../support/db.js";
import { get, post, put } from "../support/http.js";
import { createCustomer, createProduct, ledgerViolations, registerTenant } from "../support/seed.js";

const RANGE = "startDate=2026-01-01&endDate=2026-12-31";
const n = (v: unknown) => Number(v);
const line = (productId: string, quantity: number, unitPrice: number, extra: object = {}) => ({ productId, quantity, unitPrice, ...extra });

async function shop(inclusive = true) {
  const t = await registerTenant("Inclusive Shop");
  expect((await put("/businesses/current", t, { taxPin: "P051234567Q", vatRegistered: true, vatRate: "16", pricesIncludeVat: inclusive })).status).toBe(200);
  const p = (name: string, price: number, taxClass?: string) => createProduct(t, { name, costPrice: 1, sellingPrice: price, stockQuantity: 100000, ...(taxClass && { taxClass }) });
  return {
    t,
    p116: await p("Std 116", 116), p100: await p("Std 100", 100), p1000: await p("Std 1000", 1000),
    zero: await p("Zero 500", 500, "zero_rated"), exempt: await p("Exempt 300", 300, "exempt"),
  };
}

describe("VAT-inclusive pricing", () => {
  beforeAll(resetData);

  it("takes VAT out of the entered price exactly: net + tax = gross, rounded half up on the net", async () => {
    const s = await shop();
    const a = await post("/sales", s.t, { amountPaid: 116, paymentMethod: "cash", items: [line(s.p116.id, 1, 116)] });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    expect([n(a.body.data.subtotal), n(a.body.data.discount), n(a.body.data.tax), n(a.body.data.total)]).toEqual([100, 0, 16, 116]);

    // 100 inclusive: 100 / 1.16 = 86.2069 -> net 86.21, VAT 13.79, customer still pays exactly 100
    const b = await post("/sales", s.t, { amountPaid: 100, paymentMethod: "cash", items: [line(s.p100.id, 1, 100)] });
    expect([n(b.body.data.subtotal), n(b.body.data.tax), n(b.body.data.total)]).toEqual([86.21, 13.79, 100]);
    expect(n(b.body.data.items[0].total)).toBe(100);
    expect(n(b.body.data.items[0].tax)).toBe(13.79);
  });

  it("applies VAT to standard-rated lines only", async () => {
    const s = await shop();
    // 2 x 1,000 standard (gross 2,000) + 500 zero-rated + 300 exempt = 2,800 paid. 2000/1.16 = 1724.14, VAT 275.86
    const r = await post("/sales", s.t, { amountPaid: 2800, paymentMethod: "cash", items: [line(s.p1000.id, 2, 1000), line(s.zero.id, 1, 500), line(s.exempt.id, 1, 300)] });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data.items.map((i: any) => n(i.tax))).toEqual([275.86, 0, 0]);
    expect([n(r.body.data.subtotal), n(r.body.data.discount), n(r.body.data.tax), n(r.body.data.total)]).toEqual([2524.14, 0, 275.86, 2800]);
  });

  it("treats line discounts as VAT-inclusive", async () => {
    const s = await shop();
    // 1,000 less a 116 discount = 884 gross -> net 762.07, VAT 121.93. VAT-free discount is 100.00 (= 116 / 1.16)
    const r = await post("/sales", s.t, { amountPaid: 884, paymentMethod: "cash", items: [line(s.p1000.id, 1, 1000, { discount: 116 })] });
    expect([n(r.body.data.subtotal), n(r.body.data.discount), n(r.body.data.tax), n(r.body.data.total)]).toEqual([862.07, 100, 121.93, 884]);
    expect(n(r.body.data.items[0].total)).toBe(884);
  });

  it("shares a sale-level discount over the lines and recovers it exactly", async () => {
    const s = await shop();
    // 1,000 standard + 500 zero-rated, 232 off the whole sale: shares 154.67 and 77.33.
    const body = { discount: 232, amountPaid: 1268, paymentMethod: "cash", items: [line(s.p1000.id, 1, 1000), line(s.zero.id, 1, 500)] };
    const r = await post("/sales", s.t, body);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect([n(r.body.data.subtotal), n(r.body.data.discount), n(r.body.data.tax), n(r.body.data.total)]).toEqual([1362.07, 210.67, 116.6, 1268]);
    const detail = (await get(`/sales/${r.body.data.id}`, s.t)).body.data;
    expect(detail.pricesIncludeVat).toBe(true);
    expect(n(detail.saleDiscount)).toBe(232);

    const preview = await post("/sales/preview", s.t, { discount: 232, items: body.items });
    expect(preview.body.data.pricesIncludeVat).toBe(true);
    expect([n(preview.body.data.tax), n(preview.body.data.total)]).toEqual([116.6, 1268]);
    expect((await post("/sales/preview", s.t, { discount: 1501, items: body.items })).status).toBe(400);
  });

  it("ignores any tax the client sends, and keeps total = subtotal - discount + tax (database rule) on random carts", async () => {
    const s = await shop();
    let seed = 20261121;
    const rnd = (max: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % max; };
    const items = [s.p116, s.p100, s.p1000, s.zero, s.exempt];
    const prices = [116, 100, 1000, 500, 300];
    const customer = await createCustomer(s.t, "Credit Customer"); // unpaid sales need one
    let recorded = 0;
    for (let i = 0; i < 40; i++) {
      const cart = Array.from({ length: 1 + rnd(5) }, () => {
        const k = rnd(5);
        const quantity = (1 + rnd(5000)) / 1000;           // up to 3 decimals
        const gross = Math.round(quantity * prices[k]! * 100);
        const discount = rnd(3) === 0 ? rnd(Math.max(1, Math.floor(gross / 2))) / 100 : 0;
        return { ...line(items[k]!.id, quantity, prices[k]!, { discount, tax: 999 }), discount };
      });
      const lineGross = cart.map((c) => Math.round(c.quantity * c.unitPrice * 100) - Math.round(c.discount * 100));
      const sum = lineGross.reduce((a, b) => a + b, 0);
      const saleDiscount = rnd(2) ? rnd(Math.floor(sum / 2) + 1) / 100 : 0;
      const r = await post("/sales", s.t, { discount: saleDiscount, amountPaid: 0, items: cart, customerId: customer.id });
      expect(r.status, JSON.stringify([cart, saleDiscount, r.body])).toBe(201);
      const d = r.body.data;
      const cents = (v: unknown) => Math.round(n(v) * 100);
      expect(cents(d.total)).toBe(sum - Math.round(saleDiscount * 100));
      expect(cents(d.subtotal) - cents(d.discount) + cents(d.tax)).toBe(cents(d.total));
      expect(d.items.reduce((t: number, it: any) => t + cents(it.tax), 0)).toBe(cents(d.tax));
      expect(d.items.every((it: any) => cents(it.tax) >= 0)).toBe(true);
      recorded++;
    }
    expect(recorded).toBe(40); // every random cart was really priced and recorded, none skipped
    expect(await ledgerViolations()).toEqual([]);
  });

  it("a sale keeps the mode it was sold in when the business setting changes later", async () => {
    const s = await shop();
    const sale = await post("/sales", s.t, { amountPaid: 1000, paymentMethod: "cash", items: [line(s.p1000.id, 1, 1000)] });
    expect(n(sale.body.data.total)).toBe(1000);

    expect((await put("/businesses/current", s.t, { pricesIncludeVat: false })).status).toBe(200);
    // new sales are exclusive again: 1,000 + 16% = 1,160
    const next = await post("/sales", s.t, { amountPaid: 1160, paymentMethod: "cash", items: [line(s.p1000.id, 1, 1000)] });
    expect([n(next.body.data.tax), n(next.body.data.total)]).toEqual([160, 1160]);

    // editing the old sale re-prices it as inclusive, not exclusive
    const edit = await put(`/sales/${sale.body.data.id}`, s.t, { items: [line(s.p1000.id, 1, 1000)] });
    expect(edit.status, JSON.stringify(edit.body)).toBe(200);
    expect([n(edit.body.data.tax), n(edit.body.data.total)]).toEqual([137.93, 1000]);
    expect((await get(`/sales/${sale.body.data.id}`, s.t)).body.data.pricesIncludeVat).toBe(true);
    expect((await get(`/sales/${next.body.data.id}`, s.t)).body.data.pricesIncludeVat).toBe(false);
    expect(await ledgerViolations()).toEqual([]);
  });

  it("a quotation converts in the mode it was quoted in, so the total matches the quote", async () => {
    const s = await shop();
    const q = await post("/quotations", s.t, { items: [line(s.p1000.id, 3, 1000, { discount: 100 })], discount: 50 });
    expect(q.status, JSON.stringify(q.body)).toBe(201);
    const quoted = q.body.data;
    expect(quoted.pricesIncludeVat).toBe(true);
    expect(n(quoted.total)).toBe(2850);
    expect(n(quoted.saleDiscount)).toBe(50);

    expect((await put("/businesses/current", s.t, { pricesIncludeVat: false })).status).toBe(200);
    expect((await post(`/quotations/${quoted.id}/status`, s.t, { status: "accepted" })).status).toBe(200);
    const conv = await post(`/quotations/${quoted.id}/convert`, s.t, { amountPaid: 2850, paymentMethod: "cash" });
    expect(conv.status, JSON.stringify(conv.body)).toBe(201);
    expect(n(conv.body.data.sale.total)).toBe(2850);
    expect(n(conv.body.data.sale.tax)).toBe(n(quoted.tax));
  });

  it("invoices and the created sale report the mode, so documents can say the VAT is included", async () => {
    const s = await shop();
    const sale = await post("/sales", s.t, { amountPaid: 1000, paymentMethod: "cash", items: [line(s.p1000.id, 1, 1000)] });
    expect(sale.body.data.pricesIncludeVat).toBe(true);
    const inv = await post("/invoices", s.t, { saleId: sale.body.data.id });
    expect(inv.status, JSON.stringify(inv.body)).toBe(201);
    const shown = (await get(`/invoices/${inv.body.data.id}`, s.t)).body.data;
    expect(shown.pricesIncludeVat).toBe(true);
    expect([n(shown.tax), n(shown.total)]).toEqual([137.93, 1000]);
  });

  it("reports net sales without the VAT that is inside inclusive prices", async () => {
    const s = await shop();
    await post("/sales", s.t, { amountPaid: 1000, paymentMethod: "cash", items: [line(s.p1000.id, 1, 1000)] });
    const r = (await get(`/reports?${RANGE}`, s.t)).body.data;
    expect([r.summary.totalSales, r.summary.salesTax, r.summary.netSales]).toEqual([1000, 137.93, 862.07]);
    expect(r.salesByCategory.reduce((t: number, c: any) => t + c.netSales, 0)).toBeCloseTo(862.07, 2);
  });

  it("can only be switched on for a VAT-registered business, and switches off with VAT", async () => {
    const t = await registerTenant("No VAT Yet");
    expect((await put("/businesses/current", t, { pricesIncludeVat: true })).status).toBe(400);
    const plain = await createProduct(t, { name: "P", costPrice: 1, sellingPrice: 100, stockQuantity: 5 });
    const sale = await post("/sales", t, { amountPaid: 100, paymentMethod: "cash", items: [line(plain.id, 1, 100)] });
    expect([n(sale.body.data.tax), n(sale.body.data.total)]).toEqual([0, 100]);

    const s = await shop();
    expect((await put("/businesses/current", s.t, { vatRegistered: false })).status).toBe(200);
    const profile = (await get("/businesses/current", s.t)).body.data;
    expect(profile.vatRegistered).toBe(false);
    expect(profile.pricesIncludeVat).toBe(false);
    expect((await query(`select prices_include_vat from businesses where id=$1`, [s.t.businessId]))[0]!.prices_include_vat).toBe(false);
  });

  it("voiding an inclusive sale restores stock and refunds what was paid", async () => {
    const s = await shop();
    const sale = await post("/sales", s.t, { amountPaid: 116, paymentMethod: "cash", items: [line(s.p116.id, 1, 116)] });
    const v = await post(`/sales/${sale.body.data.id}/void`, s.t, { reason: "Returned", refundMethod: "cash" });
    expect(v.status, JSON.stringify(v.body)).toBe(200);
    expect(await ledgerViolations()).toEqual([]);
  });
});
