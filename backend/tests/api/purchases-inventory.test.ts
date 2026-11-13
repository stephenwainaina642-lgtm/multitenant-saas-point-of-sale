import { describe, it, expect, beforeAll } from "vitest";
import { query, resetData } from "../support/db.js";
import { post } from "../support/http.js";
import { createProduct, ledgerViolations, seedHardwareStore, seedPerfumeBusiness, stockOf } from "../support/seed.js";

describe("purchases and inventory", () => {
  beforeAll(resetData);

  it("purchase receives stock, records an IN movement and updates cost price", async () => {
    const s = await seedPerfumeBusiness();
    const before = await stockOf(s.oud6.id);
    const res = await post("/purchases", s.t, {
      supplierId: s.supplier.id, invoiceNumber: "DFT-0042", amountPaid: 20000,
      items: [{ productId: s.oud6.id, quantity: 50, unitCost: 470 }],
    });
    expect(res.status).toBe(201);
    expect(Number(res.body.data.total)).toBe(23500);
    expect(Number(res.body.data.balanceDue)).toBe(3500);
    expect(await stockOf(s.oud6.id)).toBe(before + 50);
    const mv = await query(`select type, quantity from inventory_movements where reference = $1`, [`PURCHASE-${res.body.data.id}`]);
    expect(mv).toEqual([{ type: "IN", quantity: "50.000" }]);
    const [p] = await query(`select cost_price from products where id = $1`, [s.oud6.id]);
    expect(Number(p!.cost_price)).toBe(470);
  });

  it("purchase accepts decimal quantities (hardware, metres of pipe)", async () => {
    const s = await seedHardwareStore();
    const before = await stockOf(s.pipe.id);
    const res = await post("/purchases", s.t, {
      supplierId: s.supplier.id,
      items: [{ productId: s.pipe.id, quantity: 12.5, unitCost: 300 }],
    });
    expect(res.status).toBe(201);
    expect(await stockOf(s.pipe.id)).toBeCloseTo(before + 12.5, 3);
  });

  it("purchase validation: no items, bad supplier, negative cost, overpaying", async () => {
    const s = await seedPerfumeBusiness();
    const item = { productId: s.oud6.id, quantity: 1, unitCost: 100 };
    expect((await post("/purchases", s.t, { supplierId: s.supplier.id, items: [] })).status).toBe(400);
    expect((await post("/purchases", s.t, { supplierId: "999999", items: [item] })).status).toBeGreaterThanOrEqual(400);
    expect((await post("/purchases", s.t, { supplierId: s.supplier.id, items: [{ ...item, unitCost: -1 }] })).status).toBeGreaterThanOrEqual(400);
    expect((await post("/purchases", s.t, { supplierId: s.supplier.id, amountPaid: 500, items: [item] })).status).toBeGreaterThanOrEqual(400);
  });

  it("a failing purchase line leaves stock and history unchanged (rollback)", async () => {
    const s = await seedPerfumeBusiness();
    const before = await stockOf(s.oud6.id);
    const movements = await query(`select count(*)::int as n from inventory_movements`);
    const res = await post("/purchases", s.t, {
      supplierId: s.supplier.id,
      items: [
        { productId: s.oud6.id, quantity: 10, unitCost: 450 },
        { productId: "999999", quantity: 1, unitCost: 1 },
      ],
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await stockOf(s.oud6.id)).toBe(before);
    expect(await query(`select count(*)::int as n from inventory_movements`)).toEqual(movements);
  });

  it("inventory IN / OUT / ADJUSTMENT update stock and write auditable movements", async () => {
    const s = await seedPerfumeBusiness();
    const id = s.amber.id; // opening 25
    expect((await post("/inventory", s.t, { productId: id, type: "IN", quantity: 5, notes: "Found stock" })).status).toBe(201);
    expect(await stockOf(id)).toBe(30);
    expect((await post("/inventory", s.t, { productId: id, type: "OUT", quantity: 4, notes: "Damaged" })).status).toBe(201);
    expect(await stockOf(id)).toBe(26);
    const adj = await post("/inventory", s.t, { productId: id, type: "ADJUSTMENT", quantity: 20, notes: "Physical count" });
    expect(adj.status).toBe(201);
    expect(await stockOf(id)).toBe(20);
    // IN:25 is the opening-stock movement recorded when the product was created.
    const mv = await query(`select type, quantity from inventory_movements where product_id = $1 order by id`, [id]);
    expect(mv.map((m) => `${m.type}:${Number(m.quantity)}`)).toEqual(["IN:25", "IN:5", "OUT:4", "ADJUSTMENT:-6"]);
  });

  it("inventory OUT beyond available stock is refused and stock is unchanged", async () => {
    const s = await seedPerfumeBusiness();
    const res = await post("/inventory", s.t, { productId: s.amber.id, type: "OUT", quantity: 26 });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await stockOf(s.amber.id)).toBe(25);
  });

  it("inventory rejects invalid types and negative quantities", async () => {
    const s = await seedPerfumeBusiness();
    expect((await post("/inventory", s.t, { productId: s.amber.id, type: "TELEPORT", quantity: 1 })).status).toBeGreaterThanOrEqual(400);
    expect((await post("/inventory", s.t, { productId: s.amber.id, type: "IN", quantity: -3 })).status).toBeGreaterThanOrEqual(400);
    expect((await post("/inventory", s.t, { productId: s.amber.id, type: "IN", quantity: 0 })).status).toBeGreaterThanOrEqual(400);
  });

  it("opening stock is recorded as an IN movement", async () => {
    const s = await seedPerfumeBusiness();
    const p = await createProduct(s.t, { name: "New Line", costPrice: 10, sellingPrice: 20, stockQuantity: 7 });
    expect(await stockOf(p.id)).toBe(7);
    const mv = await query(`select type, quantity from inventory_movements where product_id = $1`, [p.id]);
    expect(mv).toEqual([{ type: "IN", quantity: "7.000" }]);
  });

  it("every unit of stock is explained by inventory movements after sales and purchases", async () => {
    const s = await seedPerfumeBusiness();
    await post("/sales", s.t, { items: [{ productId: s.oud6.id, quantity: 3, unitPrice: 900 }] });
    await post("/purchases", s.t, { supplierId: s.supplier.id, items: [{ productId: s.oud12.id, quantity: 8, unitCost: 800 }] });
    const rows = await query(
      `select p.id, p.stock_quantity, coalesce(sum(
          case when m.type = 'OUT' then -m.quantity else m.quantity end), 0) as moved
         from products p left join inventory_movements m on m.product_id = p.id
        where p.business_id = $1 group by p.id`,
      [s.t.businessId]
    );
    expect(rows.length).toBe(3);
    for (const r of rows) expect(Number(r.moved), `product ${r.id}`).toBe(Number(r.stock_quantity));
  });

  it("ledger invariants hold after all of the above", async () => {
    expect(await ledgerViolations()).toEqual([]);
  });
});
