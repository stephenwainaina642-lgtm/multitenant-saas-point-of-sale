import { describe, it, expect, beforeAll } from "vitest";
import { resetData } from "../support/db.js";
import { post, put } from "../support/http.js";
import { createProduct, registerTenant, type Tenant } from "../support/seed.js";
import { applyInclusiveVat, applyVat, type SaleLine, type Vat } from "../../src/sales/sale-calc.js";
import { computeVat, percentToBps, toCents, toMilli, type VatSettings } from "../../../frontend/src/vatMath.js";

/** Small seeded generator so a failure can be reproduced. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
const CLASSES = ["standard", "zero_rated", "exempt", "reduced", "tiny"];
const CUSTOM = { reduced: "8.00", tiny: "0.50" };
const money = (r: () => number) => Math.round(r() * 200000) / 100; // up to 2,000.00
const qty = (r: () => number) => [1, 2, 3, 0.25, 0.5, 1.5, 2.75, 0.125, 10, 7][Math.floor(r() * 10)]!;

describe("offline VAT maths matches the server's exactly", () => {
  it("gives identical VAT, totals and per-line VAT on thousands of random sales (both pricing modes)", () => {
    const r = rng(20261126);
    let checked = 0;
    for (const inclusive of [false, true]) {
      for (const rate of ["16", "16.00", "14", "8.5", "0", "25"]) {
        const settings: VatSettings = { registered: true, rate, inclusive, custom: CUSTOM };
        const serverVat: Vat = { registered: true, rateBps: percentToBps(rate), inclusive, custom: new Map(Object.entries(CUSTOM).map(([k, v]) => [k, percentToBps(v)])) };
        for (let n = 0; n < 400; n++) {
          const items = Array.from({ length: 1 + Math.floor(r() * 6) }, () => ({ quantity: qty(r), unitPrice: money(r) || 1, taxClass: CLASSES[Math.floor(r() * CLASSES.length)]! }));
          const gross = items.reduce((t, i) => t + toCents(i.unitPrice) * toMilli(i.quantity) / 1000n, 0n);
          const discount = r() < 0.5 ? 0 : Math.floor((Number(gross) / 100) * r() * 0.6 * 100) / 100;
          const lines: SaleLine[] = items.map((i, k) => ({
            productId: BigInt(k + 1), productPublicId: "x", productName: "x", quantity: toMilli(i.quantity), unitPrice: toCents(i.unitPrice),
            costPrice: 0n, discount: 0n, tax: 0n, total: 0n, taxClass: i.taxClass,
          }));
          const mine = computeVat(items, discount, settings);
          if (inclusive) {
            const s = applyInclusiveVat(lines, toCents(discount), serverVat);
            expect([mine.subtotal, mine.discount, mine.tax, mine.total]).toEqual([s.subtotal, s.discount, s.tax, s.total]);
          } else {
            applyVat(lines, toCents(discount), serverVat);
            const total = lines.reduce((t, l) => t + l.total, 0n) - toCents(discount);
            const tax = lines.reduce((t, l) => t + l.tax, 0n);
            expect([mine.tax, mine.total]).toEqual([tax, total]);
          }
          expect(mine.lineTax).toEqual(lines.map((l) => l.tax));
          checked++;
        }
      }
    }
    expect(checked).toBe(4800);
  });

  describe("and the live server preview agrees with it", () => {
    const shops: { inclusive: boolean; t: Tenant; products: { id: string; price: number; taxClass: string }[] }[] = [];
    beforeAll(async () => {
      await resetData();
      for (const inclusive of [false, true]) {
        const t = await registerTenant(inclusive ? "Parity Inclusive" : "Parity Exclusive");
        expect((await put("/businesses/current", t, { taxPin: "P051234567Q", vatRegistered: true, vatRate: "16", pricesIncludeVat: inclusive })).status).toBe(200);
        const codes: Record<string, string> = { standard: "standard", zero_rated: "zero_rated", exempt: "exempt" };
        for (const [name, rate] of [["Reduced", "8"], ["Tiny", "0.5"]] as const) {
          const c = await post("/tax-rates", t, { name, rate });
          expect(c.status, JSON.stringify(c.body)).toBe(201);
          codes[name === "Reduced" ? "reduced" : "tiny"] = c.body.data.code;
        }
        const r = rng(inclusive ? 7 : 11);
        const products = [];
        for (let i = 0; i < 14; i++) {
          const cls = CLASSES[i % CLASSES.length]!;
          const price = money(r) || 1;
          const p = await createProduct(t, { name: `P${i}`, costPrice: 1, sellingPrice: price, stockQuantity: 1000000, taxClass: codes[cls]! });
          products.push({ id: p.id, price, taxClass: cls });
        }
        shops.push({ inclusive, t, products });
      }
    }, 120_000);

    it("returns the same tax and total as the offline maths for 60 random carts per pricing mode", async () => {
      const r = rng(99);
      for (const shop of shops) {
        const settings: VatSettings = { registered: true, rate: "16", inclusive: shop.inclusive, custom: CUSTOM };
        for (let n = 0; n < 60; n++) {
          const picks = Array.from({ length: 1 + Math.floor(r() * 5) }, () => shop.products[Math.floor(r() * shop.products.length)]!);
          const items = picks.map((p) => ({ productId: p.id, quantity: qty(r), unitPrice: p.price }));
          const gross = items.reduce((t, i) => t + Number(toCents(i.unitPrice) * toMilli(i.quantity) / 1000n), 0) / 100;
          const discount = r() < 0.5 ? 0 : Math.floor(gross * r() * 0.5 * 100) / 100;
          const res = await post("/sales/preview", shop.t, { discount, items });
          expect(res.status, JSON.stringify(res.body)).toBe(200);
          const mine = computeVat(items.map((i, k) => ({ quantity: i.quantity, unitPrice: i.unitPrice, taxClass: picks[k]!.taxClass })), discount, settings);
          expect([toCents(res.body.data.tax), toCents(res.body.data.total)]).toEqual([mine.tax, mine.total]);
        }
      }
    }, 120_000);
  });
});
