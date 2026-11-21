import { describe, it, expect, beforeAll } from "vitest";
import { query, resetData } from "../support/db.js";
import { addEmployee, createCustomer, createProduct, createSupplier, registerTenant } from "../support/seed.js";
import { get, post, put } from "../support/http.js";

const RANGE = "startDate=2026-01-01&endDate=2026-12-31";
const n = (v: unknown) => Number(v);
const c = (v: number) => Math.round(v * 100);
const line = (productId: string, quantity: number, unitPrice: number, extra: { discount?: number } = {}) => ({ productId, quantity, unitPrice, discount: 0, ...extra });

async function vatShop(inclusive: boolean) {
  const t = await registerTenant(`VAT Report ${inclusive ? "incl" : "excl"}`);
  expect((await put("/businesses/current", t, { taxPin: "P051234567Q", vatRegistered: true, vatRate: "16", pricesIncludeVat: inclusive })).status).toBe(200);
  const mk = (name: string, price: number, taxClass?: string) => createProduct(t, { name, costPrice: 1, sellingPrice: price, stockQuantity: 100000, ...(taxClass && { taxClass }) });
  return { t, std: await mk("Std", 1000), zero: await mk("Zero", 500, "zero_rated"), exempt: await mk("Exempt", 300, "exempt") };
}
const report = async (t: any) => (await get(`/reports/vat?${RANGE}`, t)).body.data;

describe("VAT summary report", () => {
  beforeAll(resetData);

  it("splits an exclusive-priced sale into standard, zero-rated and exempt, and reconciles to the total", async () => {
    const s = await vatShop(false);
    await post("/sales", s.t, { amountPaid: 3120, paymentMethod: "cash", items: [line(s.std.id, 2, 1000), line(s.zero.id, 1, 500), line(s.exempt.id, 1, 300)] });
    const r = await report(s.t);
    expect(r.sales).toMatchObject({
      count: 1, standardRated: { netSales: 2000, vat: 320 }, zeroRated: { netSales: 500 }, exempt: { netSales: 300 },
      noVatCharged: { netSales: 0 }, manualTax: 0, netSales: 2800, outputVat: 320, totalIncludingVat: 3120,
    });
    expect(r.business).toMatchObject({ taxPin: "P051234567Q", vatRegistered: true, vatRate: "16.00", pricesIncludeVat: false });
  });

  it("splits a VAT-inclusive sale with a sale-level discount exactly", async () => {
    const s = await vatShop(true);
    await post("/sales", s.t, { discount: 232, amountPaid: 1268, paymentMethod: "cash", items: [line(s.std.id, 1, 1000), line(s.zero.id, 1, 500)] });
    const r = await report(s.t);
    expect(r.sales.standardRated).toEqual({ netSales: 728.73, vat: 116.6 });
    expect(r.sales.zeroRated.netSales).toBe(422.67);
    expect(c(r.sales.netSales) + c(r.sales.outputVat)).toBe(c(r.sales.totalIncludingVat));
    expect(r.sales.totalIncludingVat).toBe(1268);
  });

  it("leaves out voided sales, adds input VAT from received purchases, and nets them", async () => {
    const s = await vatShop(false);
    const keep = await post("/sales", s.t, { amountPaid: 1160, paymentMethod: "cash", items: [line(s.std.id, 1, 1000)] });
    const gone = await post("/sales", s.t, { amountPaid: 1160, paymentMethod: "cash", items: [line(s.std.id, 1, 1000)] });
    await post(`/sales/${gone.body.data.id}/void`, s.t, { reason: "Mistake", refundMethod: "cash" });
    const supplier = await createSupplier(s.t, "Supplier Ltd");
    const buy = await post("/purchases", s.t, { supplierId: supplier.id, amountPaid: 1160, paymentMethod: "bank", items: [{ productId: s.std.id, quantity: 1, unitCost: 1000, tax: 160 }] });
    expect(buy.status, JSON.stringify(buy.body)).toBe(201);
    const r = await report(s.t);
    expect(keep.status).toBe(201);
    expect(r.sales).toMatchObject({ count: 1, outputVat: 160, netSales: 1000 });
    expect(r.purchases).toEqual({ count: 1, netPurchases: 1000, inputVat: 160 });
    expect(r.vatPayable).toBe(0);
    expect(r.notes.length).toBeGreaterThan(0);
  });

  it("without VAT: nothing is reported as standard-rated, and a hand-typed sale tax shows separately", async () => {
    const t = await registerTenant("No VAT Report");
    const p = await createProduct(t, { name: "P", costPrice: 1, sellingPrice: 100, stockQuantity: 100 });
    await post("/sales", t, { amountPaid: 250, paymentMethod: "cash", tax: 50, items: [line(p.id, 2, 100)] });
    const r = await report(t);
    expect(r.sales).toMatchObject({ standardRated: { netSales: 0, vat: 0 }, noVatCharged: { netSales: 200 }, manualTax: 50, outputVat: 50, totalIncludingVat: 250 });
    expect(c(r.sales.netSales) + c(r.sales.outputVat)).toBe(c(r.sales.totalIncludingVat));
  });

  it("groups by month in the business time zone and respects the date range", async () => {
    const s = await vatShop(false);
    const a = await post("/sales", s.t, { amountPaid: 1160, paymentMethod: "cash", items: [line(s.std.id, 1, 1000)] });
    const b = await post("/sales", s.t, { amountPaid: 1160, paymentMethod: "cash", items: [line(s.std.id, 1, 1000)] });
    // 22:30 UTC on 31 Oct is already 1 Nov in Nairobi (UTC+3)
    await query(`update sales set sale_date='2026-10-31 22:30:00+00' where public_id=$1::uuid`, [a.body.data.id]);
    await query(`update sales set sale_date='2026-10-15 09:00:00+00' where public_id=$1::uuid`, [b.body.data.id]);
    const r = await report(s.t);
    expect(r.byMonth.map((m: any) => [m.month, m.sales.outputVat])).toEqual([["2026-10", 160], ["2026-11", 160]]);
    const nov = (await get(`/reports/vat?startDate=2026-11-01&endDate=2026-11-30`, s.t)).body.data;
    expect([nov.sales.count, nov.sales.outputVat]).toEqual([1, 160]);
    const empty = (await get(`/reports/vat?startDate=2026-03-01&endDate=2026-03-31`, s.t)).body.data;
    expect([empty.sales.count, empty.sales.outputVat, empty.byMonth]).toEqual([0, 0, []]);
  });

  it("net + VAT equals the sale totals for many random carts in both modes", async () => {
    for (const inclusive of [false, true]) {
      const s = await vatShop(inclusive);
      const customer = await createCustomer(s.t, "Credit");
      let seed = inclusive ? 7 : 11;
      const rnd = (max: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % max; };
      const prods = [s.std, s.zero, s.exempt]; const prices = [1000, 500, 300];
      let expectedTotal = 0;
      for (let i = 0; i < 25; i++) {
        const cart = Array.from({ length: 1 + rnd(3) }, () => { const k = rnd(3); return line(prods[k]!.id, (1 + rnd(4000)) / 1000, prices[k]!, { discount: rnd(3) === 0 ? rnd(50) : 0 }); });
        const gross = cart.reduce((t, l) => t + Math.round(l.quantity * l.unitPrice * 100) - Math.round(l.discount * 100), 0);
        const discount = rnd(2) ? rnd(Math.floor(gross / 3) + 1) / 100 : 0;
        const r = await post("/sales", s.t, { discount, amountPaid: 0, customerId: customer.id, items: cart });
        expect(r.status, JSON.stringify(r.body)).toBe(201);
        expectedTotal += c(n(r.body.data.total));
      }
      const r = await report(s.t);
      expect(r.sales.count).toBe(25);
      expect(c(r.sales.totalIncludingVat)).toBe(expectedTotal);
      expect(c(r.sales.netSales) + c(r.sales.outputVat)).toBe(expectedTotal);
      // the monthly rows add up to the period
      expect(r.byMonth.reduce((t: number, m: any) => t + c(m.sales.outputVat), 0)).toBe(c(r.sales.outputVat));
    }
  });

  it("is permission-checked and isolated per business", async () => {
    const s = await vatShop(false);
    const other = await vatShop(false);
    await post("/sales", s.t, { amountPaid: 1160, paymentMethod: "cash", items: [line(s.std.id, 1, 1000)] });
    expect((await report(other.t)).sales.count).toBe(0);
    const noReports = await addEmployee(s.t, "NoReports", ["sales.create"]);
    expect((await get(`/reports/vat?${RANGE}`, noReports)).status).toBe(403);
    expect((await get(`/reports/vat?startDate=bad&endDate=2026-12-31`, s.t)).status).toBe(400);
    expect((await get(`/reports/vat`, s.t)).status).toBe(400);
  });
});
