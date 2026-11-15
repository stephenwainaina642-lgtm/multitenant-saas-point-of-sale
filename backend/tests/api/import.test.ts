import { describe, it, expect, beforeAll } from "vitest";
import { query, resetData } from "../support/db.js";
import { del, get, post } from "../support/http.js";
import { addEmployee, createProduct, ledgerViolations, registerTenant } from "../support/seed.js";

const count = async (table: string, businessId: string) =>
  Number((await query(`select count(*)::int as n from ${table} where business_id = $1`, [businessId]))[0]!.n);

describe("CSV import (products and customers)", () => {
  beforeAll(resetData);

  it("imports products with exact money and quantities, opening-stock movements and an audit entry", async () => {
    const t = await registerTenant("Import Shop");
    const rows = [
      { name: "Cement 50kg", sku: "CEM-50", costPrice: "690", sellingPrice: "1,250.50", stockQuantity: "200", minimumStock: "40", unitOfMeasure: "bag" },
      { name: "GI Pipe", sku: "PIPE", barcode: "600111", costPrice: "310.25", sellingPrice: "420", stockQuantity: "150.505", unitOfMeasure: "metre" },
      { name: "Service call", sellingPrice: "500", stockQuantity: "" },
    ];
    const dry = await post("/import/products", t, { rows, dryRun: true });
    expect(dry.status).toBe(200);
    expect(dry.body.data).toMatchObject({ dryRun: true, total: 3, valid: 3, created: 0, errors: [] });
    expect(await count("products", t.businessId)).toBe(0);

    const res = await post("/import/products", t, { rows });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.created).toBe(3);

    const products = (await get("/products", t)).body.data;
    const cement = products.find((p: any) => p.sku === "CEM-50");
    expect(Number(cement.sellingPrice)).toBe(1250.5);
    expect(Number(cement.stockQuantity)).toBe(200);
    expect(Number(products.find((p: any) => p.sku === "PIPE").stockQuantity)).toBe(150.505);
    expect(products.find((p: any) => p.name === "Service call").unitOfMeasure).toBe("piece");
    // opening stock is explained by movements, only for products that had stock
    expect(await count("inventory_movements", t.businessId)).toBe(2);
    expect((await query(`select count(*)::int as n from audit_logs where business_id = $1 and action = 'product.import'`, [t.businessId]))[0]!.n).toBe(1);
    expect(await ledgerViolations()).toEqual([]);
  });

  it("creates nothing when any row is wrong, and says which row and field", async () => {
    const t = await registerTenant("Bad Rows Shop");
    await createProduct(t, { name: "Existing Item", sku: "EX-1", barcode: "999", costPrice: 1, sellingPrice: 2, stockQuantity: 1 });
    const gone = await createProduct(t, { name: "Old Item", sku: "OLD-1", costPrice: 1, sellingPrice: 2, stockQuantity: 0 });
    expect((await del(`/products/${gone.id}`, t)).status).toBe(200);

    const rows = [
      { name: "Fine Item", sellingPrice: "10" },                                   // 1 ok
      { name: "", sellingPrice: "10" },                                            // 2 no name
      { name: "Bad Price", sellingPrice: "12.345" },                               // 3 too many decimals
      { name: "Neg Stock", sellingPrice: "5", stockQuantity: "-1" },               // 4 negative
      { name: "Letters", sellingPrice: "abc" },                                    // 5 not a number
      { name: "No Price" },                                                        // 6 price missing
      { name: "Dupe SKU", sku: "ex-1", sellingPrice: "5" },                        // 7 existing sku (case-insensitive)
      { name: "Dupe Barcode", barcode: "999", sellingPrice: "5" },                 // 8 existing barcode
      { name: "Reuses archived sku", sku: "OLD-1", sellingPrice: "5" },            // 9 archived sku
      { name: "existing item", sellingPrice: "5" },                                // 10 existing name
      { name: "Twin", sku: "T-1", sellingPrice: "5" },                             // 11 ok
      { name: "Twin 2", sku: "T-1", sellingPrice: "5" },                           // 12 repeated in file
      { name: "x".repeat(300), sellingPrice: "5" },                                // 13 too long
    ];
    const res = await post("/import/products", t, { rows });
    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    const where = (res.body.data.errors as any[]).map((e) => `${e.row}:${e.field}`).sort();
    expect(where).toEqual(["10:Name", "12:SKU", "13:Name", "2:Name", "3:Selling price", "4:Opening stock", "5:Selling price", "6:Selling price", "7:SKU", "8:Barcode", "9:SKU"].sort());
    expect(res.body.data).toMatchObject({ total: 13, created: 0 });
    expect((res.body.data.errors as any[]).find((e) => e.row === 4).message).toBe("cannot be negative");
    // the two good rows were not created either
    expect(await count("products", t.businessId)).toBe(2);
  });

  it("re-sending the same file is refused instead of duplicating the catalogue", async () => {
    const t = await registerTenant("Resend Shop");
    const rows = [{ name: "Paint", sku: "P-1", sellingPrice: "760" }];
    expect((await post("/import/products", t, { rows })).status).toBe(201);
    expect((await post("/import/products", t, { rows })).status).toBe(422);
    expect(await count("products", t.businessId)).toBe(1);
  });

  it("limits the file, needs permission and respects business boundaries", async () => {
    const a = await registerTenant("Shop A");
    const b = await registerTenant("Shop B");
    expect((await post("/import/products", a, { rows: [] })).status).toBe(400);
    expect((await post("/import/products", a, { rows: "nope" })).status).toBe(400);
    expect((await post("/import/products", a, { rows: Array.from({ length: 501 }, (_, i) => ({ name: `P${i}`, sellingPrice: "1" })) })).status).toBe(400);
    expect((await post("/import/products", undefined, { rows: [{ name: "x", sellingPrice: "1" }] })).status).toBe(401);

    const cashier = await addEmployee(a, "Cashier");
    expect((await post("/import/products", cashier, { rows: [{ name: "x", sellingPrice: "1" }] })).status).toBe(403);
    expect((await post("/import/customers", cashier, { rows: [{ name: "x" }] })).status).toBe(403);

    // the same SKU in another business is fine
    expect((await post("/import/products", a, { rows: [{ name: "Shared", sku: "S-1", sellingPrice: "1" }] })).status).toBe(201);
    expect((await post("/import/products", b, { rows: [{ name: "Shared", sku: "S-1", sellingPrice: "1" }] })).status).toBe(201);
    expect(await count("products", a.businessId)).toBe(1);
    expect(await count("products", b.businessId)).toBe(1);
  });

  it("imports customers; refuses bad emails, repeated phones and numbers already on file", async () => {
    const t = await registerTenant("Customer Import");
    const ok = await post("/import/customers", t, {
      rows: [
        { name: "Mama Njeri", phone: "0722 000 111", creditLimit: "5,000", taxNumber: "A001234567Z" },
        { name: "Brian", phone: "0733000222", email: "brian@example.com", address: "Rongai" },
        { name: "Walk-in regular" },
      ],
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const list = (await get("/customers", t)).body.data;
    expect(list).toHaveLength(3);
    expect(list.find((c: any) => c.name === "Mama Njeri")).toMatchObject({ creditLimit: "5000.00", balance: "0.00", taxNumber: "A001234567Z" });

    const bad = await post("/import/customers", t, {
      rows: [
        { name: "A", email: "not-an-email" },          // 1
        { name: "B", phone: "0722000111" },            // 2 already on file (spaces ignored)
        { name: "C", phone: "0744000333" },            // ok
        { name: "D", phone: "0744 000 333" },          // 4 repeated in file
        { phone: "0755000444" },                       // 5 no name
        { name: "E", creditLimit: "1.234" },           // 6 bad credit limit
      ],
    });
    expect(bad.status).toBe(422);
    expect((bad.body.data.errors as any[]).map((e) => `${e.row}:${e.field}`).sort()).toEqual(["1:Email", "2:Phone", "4:Phone", "5:Name", "6:Credit limit"].sort());
    expect(await count("customers", t.businessId)).toBe(3);
  });
});
