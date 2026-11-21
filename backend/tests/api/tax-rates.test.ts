import { describe, it, expect, beforeAll } from "vitest";
import { query, resetData } from "../support/db.js";
import { del, get, post, put } from "../support/http.js";
import { addEmployee, createProduct, registerTenant, type Tenant } from "../support/seed.js";

async function setVat(t: Tenant, inclusive: boolean) {
  expect((await put("/businesses/current", t, { taxPin: "P051234567Q", vatRegistered: true, vatRate: "16", pricesIncludeVat: inclusive })).status).toBe(200);
}

describe("configurable VAT rates", () => {
  let t: Tenant, fuelCode: string;
  beforeAll(async () => { await resetData(); t = await registerTenant("Tax Shop"); await setVat(t, false); });

  it("lists the built-in classes and lets the business add its own", async () => {
    const before = (await get("/tax-rates", t)).body.data as { code: string }[];
    expect(before.map((r) => r.code)).toEqual(["standard", "zero_rated", "exempt"]);
    const bad = [{ name: "Fuel", rate: -1 }, { name: "Fuel", rate: 101 }, { name: "Fuel", rate: "abc" }, { name: "Standard", rate: 5 }, { name: "", rate: 5 }];
    for (const b of bad) expect((await post("/tax-rates", t, b)).status).toBe(400);
    const r = await post("/tax-rates", t, { name: "Fuel 8%", rate: 8 });
    expect(r.status).toBe(201);
    fuelCode = r.body.data.code;
    expect((await post("/tax-rates", t, { name: "fuel 8%", rate: 8 })).status).toBe(409);
  });

  it("a product can only use a class that exists for its own business", async () => {
    expect((await post("/products", t, { name: "X", costPrice: 1, sellingPrice: 2, stockQuantity: 1, taxClass: "rate_nope" })).status).toBe(400);
    const other = await registerTenant("Other Tax Shop");
    expect((await post("/products", other, { name: "X", costPrice: 1, sellingPrice: 2, stockQuantity: 1, taxClass: fuelCode })).status).toBe(400);
    expect((await createProduct(t, { name: "Diesel", costPrice: 100, sellingPrice: 200, stockQuantity: 100, taxClass: fuelCode } as never)).id).toBeTruthy();
  });

  it("VAT-exclusive: a custom 8% line is charged 8% and the rate is recorded on the sale", async () => {
    const diesel = (await get("/products", t)).body.data.find((p: { name: string }) => p.name === "Diesel");
    const std = await createProduct(t, { name: "Soap", costPrice: 50, sellingPrice: 100, stockQuantity: 100 });
    const sale = await post("/sales", t, { items: [{ productId: diesel.id, quantity: 1, unitPrice: 200 }, { productId: std.id, quantity: 1, unitPrice: 100 }], amountPaid: 332, paymentMethod: "cash" });
    expect(sale.status).toBe(201);
    expect(Number(sale.body.data.tax)).toBe(16 + 16); // 8% of 200 + 16% of 100
    expect(Number(sale.body.data.total)).toBe(332);
    const rows = await query<{ tax_class: string; tax_rate: string }>(`select tax_class, tax_rate from sale_items order by id`);
    expect(rows.map((r) => Number(r.tax_rate))).toEqual([8, 16]);
    expect(rows[0]!.tax_class).toBe(fuelCode);
  });

  it("changing a rate later does not rewrite recorded sales", async () => {
    expect((await put(`/tax-rates/${fuelCode}`, t, { rate: 10 })).status).toBe(200);
    const rows = await query<{ tax_rate: string }>(`select tax_rate from sale_items order by id`);
    expect(Number(rows[0]!.tax_rate)).toBe(8);
  });

  it("VAT-inclusive: net + tax equals the gross exactly for a custom rate", async () => {
    await setVat(t, true);
    const p = await createProduct(t, { name: "Gas", costPrice: 100, sellingPrice: 540, stockQuantity: 100, taxClass: fuelCode } as never);
    const sale = await post("/sales", t, { items: [{ productId: p.id, quantity: 1, unitPrice: 540 }], amountPaid: 540, paymentMethod: "cash" });
    expect(sale.status).toBe(201);
    expect(Number(sale.body.data.total)).toBe(540);
    expect(Number(sale.body.data.tax)).toBe(49.09); // 540 - 540/1.10
    expect(Number(sale.body.data.subtotal) + Number(sale.body.data.tax)).toBe(540);
  });

  it("VAT report shows the totals by rate", async () => {
    const r = await get("/reports/vat?startDate=2020-01-01&endDate=2099-12-31", t);
    expect(r.status).toBe(200);
    const rates = (r.body.data.byRate as { rate: string }[]).map((x) => x.rate);
    expect(rates).toEqual(expect.arrayContaining(["16.00", "8.00", "10.00"]));
  });

  it("a rate in use cannot be deleted; an unused one can; only settings managers may change rates", async () => {
    expect((await del(`/tax-rates/${fuelCode}`, t)).status).toBe(409);
    const spare = (await post("/tax-rates", t, { name: "Spare", rate: 3 })).body.data.code;
    expect((await del(`/tax-rates/${spare}`, t)).status).toBe(200);
    const cashier = await addEmployee(t, "Cashier");
    expect((await post("/tax-rates", cashier, { name: "Nope", rate: 1 })).status).toBe(403);
    expect((await get("/tax-rates", cashier)).status).toBe(200);
  });
});
