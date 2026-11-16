import { describe, it, expect, beforeAll } from "vitest";
import { query, resetData } from "../support/db.js";
import { get, post, put } from "../support/http.js";
import { addEmployee, createCustomer, createProduct, ledgerViolations, registerTenant } from "../support/seed.js";

const RANGE = "startDate=2026-01-01&endDate=2026-12-31";
/** Money fields may come back as "2800" or "2800.00": compare numerically, everything else exactly. */
function like(actual: any, expected: Record<string, unknown>) {
  for (const [k, v] of Object.entries(expected)) {
    if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v)) expect(Number(actual[k]), k).toBe(Number(v));
    else expect(actual[k], k).toEqual(v);
  }
}
const line = (productId: string, quantity: number, unitPrice: number, extra: object = {}) => ({ productId, quantity, unitPrice, ...extra });

async function vatShop(rate = "16") {
  const t = await registerTenant("VAT Shop");
  expect((await put("/businesses/current", t, { taxPin: "P051234567Q", vatRegistered: true, vatRate: rate })).status).toBe(200);
  const p = (name: string, price: number, taxClass?: string) => createProduct(t, { name, costPrice: 1, sellingPrice: price, stockQuantity: 1000, ...(taxClass && { taxClass }) });
  return {
    t,
    a: await p("Standard 1000", 1000),                // taxClass defaults to standard
    b: await p("Zero-rated 500", 500, "zero_rated"),
    c: await p("Exempt 300", 300, "exempt"),
    d: await p("Standard 99.99", 99.99, "standard"),
    h1: await p("Hundred 1", 100), h2: await p("Hundred 2", 100), h3: await p("Hundred 3", 100),
    tiny: await p("Four cents", 0.04),
  };
}

describe("VAT (exclusive pricing, calculated by the server)", () => {
  beforeAll(resetData);

  it("adds VAT only to standard-rated lines and keeps total = subtotal - discount + tax", async () => {
    const s = await vatShop();
    // 2 x 1,000 standard + 500 zero-rated + 300 exempt = 2,800; VAT = 16% of 2,000 = 320; total 3,120.
    const r = await post("/sales", s.t, { amountPaid: 3120, paymentMethod: "cash", items: [line(s.a.id, 2, 1000), line(s.b.id, 1, 500), line(s.c.id, 1, 300)] });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    like(r.body.data, { subtotal: "2800.00", discount: "0.00", tax: "320.00", total: "3120.00", paymentStatus: "paid" });
    expect(r.body.data.items.map((i: any) => Number(i.tax))).toEqual([320, 0, 0]);
  });

  it("rounds each line half-up to the cent", async () => {
    const s = await vatShop();
    // 3 x 99.99 = 299.97 -> 16% = 47.9952 -> 48.00
    const r = await post("/sales", s.t, { amountPaid: 347.97, paymentMethod: "cash", items: [line(s.d.id, 3, 99.99)] });
    like(r.body.data, { tax: "48.00", total: "347.97" });
    // At 12.5%, 0.04 x 0.125 = 0.005 exactly -> half-up gives 0.01
    expect((await put("/businesses/current", s.t, { vatRate: "12.5" })).body.data.vatRate).toBe("12.50");
    const r2 = await post("/sales", s.t, { amountPaid: 0.05, paymentMethod: "cash", items: [line(s.tiny.id, 1, 0.04)] });
    like(r2.body.data, { tax: "0.01", total: "0.05" });
  });

  it("shares a sale-level discount over the lines exactly, before working out VAT", async () => {
    const s = await vatShop();
    // Standard 2,000 + zero-rated 500, sale discount 250 -> shares 200 / 50 -> VAT 16% of 1,800 = 288.
    const a = await post("/sales", s.t, { discount: 250, amountPaid: 2538, paymentMethod: "cash", items: [line(s.a.id, 2, 1000), line(s.b.id, 1, 500)] });
    like(a.body.data, { subtotal: "2500.00", discount: "250.00", tax: "288.00", total: "2538.00" });
    // Three 100.00 lines, 100.00 discount -> shares 33.34 / 33.33 / 33.33 -> nets 66.66, 66.67, 66.67 -> VAT 10.67 each = 32.01
    const b = await post("/sales", s.t, { discount: 100, amountPaid: 232.01, paymentMethod: "cash", items: [line(s.h1.id, 1, 100), line(s.h2.id, 1, 100), line(s.h3.id, 1, 100)] });
    like(b.body.data, { subtotal: "300.00", discount: "100.00", tax: "32.01", total: "232.01" });
    expect(b.body.data.items.map((i: any) => Number(i.tax))).toEqual([10.67, 10.67, 10.67]);
    // a discount larger than the sale is refused
    expect((await post("/sales", s.t, { discount: 99999, amountPaid: 0, paymentMethod: "cash", items: [line(s.a.id, 1, 1000)] })).status).toBe(400);
  });

  it("ignores any tax the client sends, and the preview matches what gets recorded", async () => {
    const s = await vatShop();
    // Discount 100 over (2,000 standard, 300 exempt) = 86.96 / 13.04; VAT = 16% of 1,913.04 = 306.0864 -> 306.09.
    const items = [line(s.a.id, 2, 1000, { tax: 999 }), line(s.c.id, 1, 300)];
    const preview = await post("/sales/preview", s.t, { items, tax: 5000, discount: 100 });
    expect(preview.status).toBe(200);
    like(preview.body.data, { vatRegistered: true, vatRate: "16.00", subtotal: "2300.00", discount: "100.00", tax: "306.09", total: "2506.09" });
    const sale = await post("/sales", s.t, { items, tax: 5000, discount: 100, amountPaid: 0, customerId: (await createCustomer(s.t, "Credit Customer")).id, paymentMethod: "cash" });
    expect(sale.status, JSON.stringify(sale.body)).toBe(201);
    for (const k of ["subtotal", "discount", "tax", "total"]) expect(Number(sale.body.data[k]), k).toBe(Number(preview.body.data[k]));
    expect((await post("/sales/preview", s.t, { items: [] })).status).toBe(400);
    const cashier = await addEmployee(s.t, "Accountant");
    expect((await post("/sales/preview", cashier, { items })).status).toBe(403);
  });

  it("recalculates VAT when a sale is edited, and quotations carry the same VAT into the sale", async () => {
    const s = await vatShop();
    const customer = await createCustomer(s.t, "Edit Customer");
    const sale = (await post("/sales", s.t, { customerId: customer.id, amountPaid: 0, paymentMethod: "cash", items: [line(s.a.id, 2, 1000), line(s.b.id, 1, 500)] })).body.data;
    like(sale, { tax: "320.00", total: "2820.00" });
    const edited = await put(`/sales/${sale.id}`, s.t, { items: [line(s.a.id, 1, 1000), line(s.b.id, 1, 500)] });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    like(edited.body.data, { tax: "160.00", total: "1660.00", balanceDue: "1660.00" });

    const q = (await post("/quotations", s.t, { customerId: customer.id, items: [line(s.a.id, 3, 1000), line(s.c.id, 1, 300)] })).body.data;
    like(q, { subtotal: "3300.00", tax: "480.00", total: "3780.00" });
    await post(`/quotations/${q.id}/status`, s.t, { status: "sent" });
    await post(`/quotations/${q.id}/status`, s.t, { status: "accepted" });
    const converted = (await post(`/quotations/${q.id}/convert`, s.t, {})).body.data.sale;
    like(converted, { tax: "480.00", total: "3780.00" });
    expect(await ledgerViolations()).toEqual([]);
  });

  it("flows into reports: sales tax is what the sales carry and net sales excludes it", async () => {
    const s = await vatShop();
    await post("/sales", s.t, { amountPaid: 3120, paymentMethod: "cash", items: [line(s.a.id, 2, 1000), line(s.b.id, 1, 500), line(s.c.id, 1, 300)] });
    await post("/sales", s.t, { amountPaid: 347.97, paymentMethod: "cash", items: [line(s.d.id, 3, 99.99)] });
    const r = (await get(`/reports?${RANGE}`, s.t)).body.data.summary;
    like(r, { totalSales: 3467.97, salesTax: 368, netSales: 3099.97 });
  });

  it("is off by default: manual tax keeps working and tax classes have no effect", async () => {
    const t = await registerTenant("No VAT Shop");
    const p = await createProduct(t, { name: "Thing", costPrice: 1, sellingPrice: 100, stockQuantity: 10, taxClass: "exempt" });
    const r = await post("/sales", t, { tax: 7, amountPaid: 107, paymentMethod: "cash", items: [line(p.id, 1, 100)] });
    like(r.body.data, { tax: "7.00", total: "107.00" });
    const pv = await post("/sales/preview", t, { items: [line(p.id, 1, 100)] });
    like(pv.body.data, { vatRegistered: false, vatRate: null, tax: "0.00" });
  });

  it("guards the settings: PIN first, valid rate, owner only; and the database agrees", async () => {
    const t = await registerTenant("Settings Shop");
    expect((await put("/businesses/current", t, { vatRegistered: true })).status).toBe(400);       // no PIN yet
    expect((await put("/businesses/current", t, { taxPin: "P051234567Q", vatRegistered: true })).status).toBe(200);
    expect((await put("/businesses/current", t, { taxPin: "" })).status).toBe(400);                 // cannot drop PIN while registered
    for (const vatRate of ["abc", "101", "-1", "16.123", "1e2"]) {
      expect((await put("/businesses/current", t, { vatRate })).status, vatRate).toBe(400);
    }
    expect((await put("/businesses/current", t, { vatRegistered: "yes" })).status).toBe(400);
    const cashier = await addEmployee(t, "Cashier");
    expect((await put("/businesses/current", cashier, { vatRegistered: false })).status).toBe(403);
    await expect(query(`update businesses set vat_rate = 150 where id = $1`, [t.businessId])).rejects.toThrow(/vat_rate_range/);
    await expect(query(`update products set tax_class = 'luxury' where business_id = $1`, [t.businessId])).resolves.toBeDefined(); // no rows to update yet
    const p = await createProduct(t, { name: "X", costPrice: 1, sellingPrice: 2 });
    await expect(query(`update products set tax_class = 'luxury' where id = $1`, [p.id])).rejects.toThrow(/tax_class_valid/);
    expect((await post("/products", t, { name: "Y", costPrice: 1, sellingPrice: 2, taxClass: "luxury" })).status).toBe(400);
  });

  it("imports tax classes from CSV", async () => {
    const t = await registerTenant("Import VAT");
    const r = await post("/import/products", t, { rows: [
      { name: "Milk", sellingPrice: "60", taxClass: "Zero rated" },
      { name: "Soap", sellingPrice: "100" },
      { name: "Rent", sellingPrice: "100", taxClass: "exempt" },
    ] });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const list = (await get("/products", t)).body.data;
    expect(Object.fromEntries(list.map((p: any) => [p.name, p.taxClass]))).toEqual({ Milk: "zero_rated", Soap: "standard", Rent: "exempt" });
    const bad = await post("/import/products", t, { rows: [{ name: "Odd", sellingPrice: "1", taxClass: "luxury" }] });
    expect(bad.status).toBe(422);
  });
});
