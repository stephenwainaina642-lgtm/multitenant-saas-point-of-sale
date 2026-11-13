import { describe, it, expect, beforeAll } from "vitest";
import { query, resetData } from "../support/db.js";
import { post } from "../support/http.js";
import { createProduct, ledgerViolations, registerTenant, seedPhoneShop, stockOf } from "../support/seed.js";

/**
 * Concurrency characterization. Results depend on timing; failures here before
 * the Stage 2b fixes are expected and are evidence of real defects:
 *  KD-4 receipt numbers collide (SALE-<Date.now()>)
 *  KD-5 payments read-modify-write the sale without a lock
 *  KD-6 purchases read-modify-write product stock
 */
describe("concurrency", () => {
  beforeAll(resetData);

  it("selling the last units concurrently never oversells (guarded atomic decrement)", async () => {
    const t = await registerTenant("Race Shop");
    const p = await createProduct(t, { name: "Last Units", costPrice: 10, sellingPrice: 20, stockQuantity: 5 });
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        post("/sales", t, { amountPaid: 20, paymentMethod: "cash", items: [{ productId: p.id, quantity: 1, unitPrice: 20 }] })
      )
    );
    const ok = results.filter((r) => r.status === 201).length;
    console.log(`[race] oversell test: ${ok} succeeded, statuses=${results.map((r) => r.status).join(",")}`);
    expect(await stockOf(p.id)).toBeGreaterThanOrEqual(0);
    expect(ok).toBeLessThanOrEqual(5);
    expect(await ledgerViolations()).toEqual([]);
  });

  it("simultaneous checkouts all succeed (no receipt-number collisions)", async () => {
    const t = await registerTenant("Busy Till");
    const p = await createProduct(t, { name: "Fast Mover", costPrice: 1, sellingPrice: 2, stockQuantity: 1000 });
    const results = await Promise.all(
      Array.from({ length: 40 }, () =>
        post("/sales", t, { amountPaid: 2, paymentMethod: "cash", items: [{ productId: p.id, quantity: 1, unitPrice: 2 }] })
      )
    );
    const failed = results.filter((r) => r.status !== 201);
    console.log(`[race] receipt collision test: ${failed.length}/40 failed, statuses=${[...new Set(failed.map((r) => r.status))].join(",") || "none"}`);
    expect(failed.length).toBe(0);
  });

  it("concurrent payments cannot overpay or break reconciliation", async () => {
    const s = await seedPhoneShop();
    const sale = await post("/sales", s.t, { customerId: s.customer.id, items: [{ productId: s.galaxy.id, quantity: 1, unitPrice: 21500 }] });
    const id = sale.body.data.id;
    const results = await Promise.all(
      Array.from({ length: 8 }, () => post("/payments", s.t, { saleId: id, amount: 21500, method: "mpesa" }))
    );
    const ok = results.filter((r) => r.status === 201).length;
    const [row] = await query(`select amount_paid, total from sales where id = $1`, [id]);
    const [sum] = await query(`select coalesce(sum(amount),0) as s from payments where sale_id = $1`, [id]);
    console.log(`[race] payment test: ${ok} accepted, payments sum=${sum!.s}, sale.amount_paid=${row!.amount_paid}, total=${row!.total}`);
    expect(ok).toBe(1);
    expect(Number(sum!.s)).toBe(Number(row!.amount_paid));
    expect(await ledgerViolations()).toEqual([]);
  });

  it("concurrent purchase receipts add up exactly", async () => {
    const s = await seedPhoneShop();
    const before = await stockOf(s.charger.id);
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        post("/purchases", s.t, { supplierId: s.supplier.id, items: [{ productId: s.charger.id, quantity: 10, unitCost: 650 }] })
      )
    );
    const ok = results.filter((r) => r.status === 201).length;
    const after = await stockOf(s.charger.id);
    console.log(`[race] purchase test: ${ok} accepted, expected +${ok * 10}, actual +${after - before}`);
    expect(after - before).toBe(ok * 10);
  });
});
