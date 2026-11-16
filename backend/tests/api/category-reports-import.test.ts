import { describe, it, expect, beforeAll } from "vitest";
import { query, resetData } from "../support/db.js";
import { get, post } from "../support/http.js";
import { ledgerViolations, registerTenant } from "../support/seed.js";

const RANGE = "startDate=2026-01-01&endDate=2026-12-31";

describe("categories in CSV import and the sales-by-category report", () => {
  beforeAll(resetData);

  it("import reuses categories (any capitalisation), creates new ones only on confirm, and is all-or-nothing", async () => {
    const t = await registerTenant("Import Cat");
    const existing = (await post("/categories", t, { name: "Plumbing" })).body.data.id;
    const rows = [
      { name: "Pipe", sellingPrice: "100", category: "plumbing" },
      { name: "Tap", sellingPrice: "200", category: " Plumbing " },
      { name: "Hammer", sellingPrice: "300", category: "Tools" },
      { name: "Saw", sellingPrice: "400", category: "TOOLS" },
      { name: "Loose", sellingPrice: "50" },
    ];
    const dry = await post("/import/products", t, { rows, dryRun: true });
    expect(dry.body.data.newCategories).toEqual(["Tools"]);
    expect((await get("/categories", t)).body.data).toHaveLength(1); // dry run created nothing

    const bad = await post("/import/products", t, { rows: [...rows, { name: "Bad", sellingPrice: "1", category: "x".repeat(151) }] });
    expect(bad.status).toBe(422);
    expect((await get("/categories", t)).body.data).toHaveLength(1); // failed file created no category either

    expect((await post("/import/products", t, { rows })).status).toBe(201);
    const cats = (await get("/categories", t)).body.data;
    expect(cats.map((c: any) => [c.name, c.productCount]).sort()).toEqual([["Plumbing", 2], ["Tools", 2]]);
    const products = (await get("/products", t)).body.data;
    expect(products.find((p: any) => p.name === "Pipe").categoryId).toBe(existing);
    expect(products.find((p: any) => p.name === "Loose").categoryId).toBeNull();
    const audit = await query(`select details from audit_logs where business_id=$1 and action='product.import'`, [t.businessId]);
    expect(audit[0]!.details.newCategories).toEqual(["Tools"]);
  });

  it("groups net sales and cost by category and reconciles with net sales, including VAT and discounts", async () => {
    const t = await registerTenant("Report Cat");
    const phones = (await post("/categories", t, { name: "Phones" })).body.data.id;
    const acc = (await post("/categories", t, { name: "Accessories" })).body.data.id;
    const mk = async (body: object) => (await post("/products", t, { costPrice: 0, stockQuantity: 100, ...body })).body.data;
    const phone = await mk({ name: "Phone", costPrice: 15000, sellingPrice: 20000, categoryId: phones });
    const cable = await mk({ name: "Cable", costPrice: 100, sellingPrice: 300, categoryId: acc });
    const loose = await mk({ name: "Loose", costPrice: 10, sellingPrice: 25 });
    const sold = await post("/sales", t, { amountPaid: 20680, paymentMethod: "cash", items: [{ productId: phone.id, quantity: 1, unitPrice: 20000 }, { productId: cable.id, quantity: 2, unitPrice: 300 }, { productId: loose.id, quantity: 4, unitPrice: 25, discount: 20 }] });

    expect(sold.status).toBe(201);
    const r = (await get(`/reports?${RANGE}`, t)).body.data;
    const byName = Object.fromEntries(r.salesByCategory.map((c: any) => [c.categoryName, c]));
    expect(byName.Phones).toMatchObject({ netSales: 20000, costOfGoodsSold: 15000, grossProfit: 5000 });
    expect(byName.Accessories).toMatchObject({ netSales: 600, costOfGoodsSold: 200, grossProfit: 400 });
    expect(byName.Uncategorized).toMatchObject({ categoryId: null, netSales: 80, costOfGoodsSold: 40, grossProfit: 40 });
    expect(r.salesByCategory.map((c: any) => c.categoryName)).toEqual(["Phones", "Accessories", "Uncategorized"]);
    expect(r.salesByCategory.reduce((a: number, c: any) => a + c.netSales, 0)).toBe(r.summary.netSales);
    expect(r.salesByCategory.reduce((a: number, c: any) => a + c.costOfGoodsSold, 0)).toBe(r.summary.costOfGoodsSold);
    expect(await ledgerViolations()).toEqual([]);
  });

  it("voided sales are excluded and a re-categorised product moves its figures", async () => {
    const t = await registerTenant("Report Cat 2");
    const a = (await post("/categories", t, { name: "A" })).body.data.id;
    const p = (await post("/products", t, { name: "P", costPrice: 1, sellingPrice: 10, stockQuantity: 50, categoryId: a })).body.data;
    const sale = await post("/sales", t, { amountPaid: 100, paymentMethod: "cash", items: [{ productId: p.id, quantity: 10, unitPrice: 10 }] });
    expect((await get(`/reports?${RANGE}`, t)).body.data.salesByCategory[0]).toMatchObject({ categoryName: "A", netSales: 100 });
    await post(`/sales/${sale.body.data.id}/void`, t, { reason: "Returned", refundMethod: "cash" });
    expect((await get(`/reports?${RANGE}`, t)).body.data.salesByCategory).toEqual([]);
  });
});
