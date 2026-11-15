import { describe, it, expect, beforeAll } from "vitest";
import { query, resetData } from "../support/db.js";
import { get, post } from "../support/http.js";
import { loadTestConfig } from "../support/env.js";
import { startServer, waitForHealth } from "../support/server.js";
import { addEmployee, createProduct, registerTenant, seedPhoneShop } from "../support/seed.js";
import { dayKey, nextDay, startOfDay } from "../../src/lib/timezone.js";

const TZ = "Africa/Nairobi";
const dash = async (t: any) => (await get("/dashboard", t)).body.data;
const sumTotals = (rows: { total: number }[]) => rows.reduce((a, r) => a + r.total, 0);

describe("dashboard", () => {
  beforeAll(async () => { await resetData(); });

  it("every figure is exact and excludes voided sales", async () => {
    const s = await seedPhoneShop();
    const sale = (body: object) => post("/sales", s.t, body);
    await sale({ amountPaid: 2300, paymentMethod: "cash", items: [{ productId: s.charger.id, quantity: 2, unitPrice: 1200, discount: 100 }] });
    await sale({ customerId: s.customer.id, amountPaid: 10000, paymentMethod: "mpesa", items: [{ productId: s.galaxy.id, quantity: 1, unitPrice: 21500, tax: 200 }] });
    const c = await sale({ amountPaid: 112000, paymentMethod: "bank", items: [{ productId: s.iphone.id, quantity: 1, unitPrice: 112000 }] });
    await post(`/sales/${c.body.data.id}/void`, s.t, { reason: "Returned", refundMethod: "bank" });
    // 10 chargers bought for 6500, 2000 paid -> 4500 owed
    await post("/purchases", s.t, { supplierId: s.supplier.id, amountPaid: 2000, paymentMethod: "bank", items: [{ productId: s.charger.id, quantity: 10, unitCost: 650 }] });

    const d = await dash(s.t);
    expect(d.timeZone).toBe(TZ);
    expect(d.sales.today).toEqual({ count: 2, revenue: 24000 });
    expect(d.sales.thisMonth).toEqual({ count: 2, revenue: 24000 });
    expect(d.sales.allTime).toEqual({ count: 2, revenue: 24000 });
    expect(d.receivables).toEqual({ outstanding: 11700, unpaidSales: 1 });
    expect(d.payables).toEqual({ outstanding: 4500, unpaidPurchases: 1 });
    // charger 40-2+10 = 48, galaxy 11, iphone 5 (sale voided, stock restored)
    expect(d.stock.units).toBe(48 + 11 + 5);
    expect(d.stock.productCount).toBe(3);
    expect(d.stock.value).toBe(48 * 650 + 11 * 17500 + 5 * 98000);
    expect(d.stock.lowStockCount).toBe(0);
    // each chart adds up to the same revenue
    for (const k of ["week", "month", "year"]) expect(sumTotals(d.charts[k])).toBe(24000);
    expect(d.charts.week).toHaveLength(7);
    expect(d.charts.year).toHaveLength(12);
    expect(d.performance).toHaveLength(1);
    expect(d.performance[0]).toMatchObject({ salesCount: 2, revenue: 24000, collected: 12300, outstanding: 11700 });
    expect(d.recentSales.map((x: any) => x.status)).toEqual(["completed", "completed"]);
    expect(d.recentSales[0].customerName).toBe("Wanjiku Kamau");
  });

  it("lists low-stock products, lowest first", async () => {
    const s = await seedPhoneShop();
    await createProduct(s.t, { name: "Cable", costPrice: 100, sellingPrice: 200, stockQuantity: 1, minimumStock: 5 });
    await createProduct(s.t, { name: "Case", costPrice: 100, sellingPrice: 200, stockQuantity: 2.5, minimumStock: 2.5 });
    const d = await dash(s.t);
    expect(d.stock.lowStockCount).toBe(2);
    expect(d.stock.lowStock.map((p: any) => [p.name, p.stockQuantity])).toEqual([["Cable", 1], ["Case", 2.5]]);
  });

  it("sums are free of floating-point error", async () => {
    const s = await seedPhoneShop();
    const pen = await createProduct(s.t, { name: "Pen", costPrice: 0.05, sellingPrice: 0.1, stockQuantity: 100 });
    for (let i = 0; i < 3; i++) await post("/sales", s.t, { customerId: s.customer.id, amountPaid: 0, paymentMethod: "cash", items: [{ productId: pen.id, quantity: 1, unitPrice: 0.1 }] });
    const d = await dash(s.t);
    expect(d.sales.today.revenue).toBe(0.3);
    expect(d.receivables.outstanding).toBe(0.3);
  });

  it("'today' is the business's day: Nairobi midnight is 21:00 UTC", async () => {
    const s = await seedPhoneShop();
    const r = await post("/sales", s.t, { amountPaid: 1200, paymentMethod: "cash", items: [{ productId: s.charger.id, quantity: 1, unitPrice: 1200 }] });
    const id = r.body.data.id;
    const start = startOfDay(dayKey(new Date(), TZ, false), TZ);
    expect(start.getUTCHours()).toBe(21);
    await query(`update sales set sale_date = $1 where id = $2`, [new Date(start.getTime() - 60_000), id]);
    expect((await dash(s.t)).sales.today.count).toBe(0);
    await query(`update sales set sale_date = $1 where id = $2`, [new Date(start.getTime() + 60_000), id]);
    expect((await dash(s.t)).sales.today.count).toBe(1);
    // the end of the day is exclusive
    const end = startOfDay(nextDay(dayKey(new Date(), TZ, false)), TZ);
    await query(`update sales set sale_date = $1 where id = $2`, [end, id]);
    expect((await dash(s.t)).sales.today.count).toBe(0);
  });

  it("a salesperson sees only their own sales; sections without permission are hidden", async () => {
    const s = await seedPhoneShop();
    const cashier = await addEmployee(s.t, "Counter", ["sales.create", "sales.view_own", "payments.create", "products.view"]);
    await post("/sales", s.t, { amountPaid: 1200, paymentMethod: "cash", items: [{ productId: s.charger.id, quantity: 1, unitPrice: 1200 }] });
    await post("/sales", cashier, { amountPaid: 21500, paymentMethod: "cash", items: [{ productId: s.galaxy.id, quantity: 1, unitPrice: 21500 }] });

    const d = await dash(cashier);
    expect(d.sales.allTime).toEqual({ count: 1, revenue: 21500 });
    expect(d.performance).toBeNull();            // not allowed to see the team
    expect(d.payables).toBeNull();               // no purchases.view
    expect(d.stock).not.toBeNull();              // has products.view
    expect(d.recentSales).toHaveLength(1);

    const nothing = await addEmployee(s.t, "Guest", []);
    const g = await dash(nothing);
    expect(g.sales).toBeNull();
    expect(g.stock).toBeNull();
    expect(g.receivables).toBeNull();
    expect(g.recentSales).toBeNull();
    expect(g.charts).toBeNull();

    const owner = await dash(s.t);
    expect(owner.sales.allTime.count).toBe(2);
    expect(owner.performance).toHaveLength(2);
  });

  it("never mixes in another business and needs a sign-in", async () => {
    const a = await seedPhoneShop();
    const b = await registerTenant("Other Shop");
    await post("/sales", a.t, { amountPaid: 1200, paymentMethod: "cash", items: [{ productId: a.charger.id, quantity: 1, unitPrice: 1200 }] });
    const d = await dash(b);
    expect(d.sales.allTime).toEqual({ count: 0, revenue: 0 });
    expect(d.stock.productCount).toBe(0);
    expect(d.receivables.outstanding).toBe(0);
    expect((await get("/dashboard", { token: "", businessId: a.t.businessId } as any)).status).toBe(401);
    // a business the user doesn't belong to is refused
    expect((await get("/dashboard", { ...b, businessId: a.t.businessId })).status).toBe(403);
  });

  it("reads timestamps correctly even when the database's own time zone is not UTC", async () => {
    const s = await seedPhoneShop();
    const r = await post("/sales", s.t, { amountPaid: 1200, paymentMethod: "cash", items: [{ productId: s.charger.id, quantity: 1, unitPrice: 1200 }] });
    await query(`update sales set sale_date = '2026-03-01T21:30:00Z' where id = $1`, [r.body.data.id]);
    const db = (await query<{ db: string }>(`select current_database() as db`))[0]!.db;
    const tz = (await query<{ tz: string }>(`select current_setting('TimeZone') as tz`))[0]!.tz;
    const cfg = loadTestConfig();
    const port = cfg.apiPort + 4;
    try {
      // Anything other than UTC would shift every timestamp the ORM reads, unless the app pins UTC.
      await query(`alter database "${db}" set timezone = 'America/New_York'`);
      const srv = startServer(port);
      try {
        await waitForHealth(`http://127.0.0.1:${port}/api/health`, 40_000, srv);
        const res = await fetch(`http://127.0.0.1:${port}/api/sales/${r.body.data.id}`, {
          headers: { authorization: `Bearer ${s.t.token}`, "x-business-id": s.t.businessId },
        });
        expect(new Date((await res.json()).data.saleDate).toISOString()).toBe("2026-03-01T21:30:00.000Z");
      } finally { await srv.stop(); }
    } finally {
      await query(`alter database "${db}" set timezone = '${tz}'`);
    }
  });

  it("tells the screens which permissions the member holds (business select and dashboard)", async () => {
    const s = await seedPhoneShop();
    const cashier = await addEmployee(s.t, "Counter", ["sales.create", "sales.view_own", "payments.create"]);
    const accountant = await addEmployee(s.t, "Accountant");   // built-in defaults

    const pick = async (t: any) => (await post("/business-context/select", { token: t.token }, { businessId: t.businessId })).body.data;
    const owner = await pick(s.t);
    expect(owner.permissions).toContain("settings.manage");
    expect(owner.permissions).toContain("sales.void");

    const c = await pick(cashier);
    expect(c.permissions).toEqual(["payments.create", "sales.create", "sales.view_own"]);
    expect((await dash(cashier)).permissions).toEqual(c.permissions);

    const a = await pick(accountant);
    expect(a.permissions).toContain("reports.view");
    expect(a.permissions).not.toContain("sales.void");
    expect(a.permissions).not.toContain("roles.manage");
  });
});
