import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { query, resetData } from "../support/db.js";
import { loadTestConfig } from "../support/env.js";
import { get, post } from "../support/http.js";
import { startServer, waitForHealth, type RunningServer } from "../support/server.js";
import { addEmployee, createProduct, ledgerViolations, seedPhoneShop } from "../support/seed.js";
import { dayKey, nextDay, startOfDay } from "../../src/lib/timezone.js";

const cfg = loadTestConfig();
const RANGE = "startDate=2026-01-01&endDate=2026-12-31";

describe("reports", () => {
  beforeAll(async () => { await resetData(); });

  it("totals are exact on a known scenario (voided sales excluded, refunds and supplier payments shown)", async () => {
    const s = await seedPhoneShop();
    const sale = (body: object) => post("/sales", s.t, body);

    // A: 2 chargers @1200, KES 100 line discount -> 2300, paid in full
    expect((await sale({ amountPaid: 2300, paymentMethod: "cash", items: [{ productId: s.charger.id, quantity: 2, unitPrice: 1200, discount: 100 }] })).status).toBe(201);
    // B: galaxy 21500 + KES 200 tax -> 21700, 10000 paid by M-Pesa, rest on credit
    expect((await sale({ customerId: s.customer.id, amountPaid: 10000, paymentMethod: "mpesa", items: [{ productId: s.galaxy.id, quantity: 1, unitPrice: 21500, tax: 200 }] })).status).toBe(201);
    // C: iPhone, paid then voided and refunded in full
    const c = await sale({ amountPaid: 112000, paymentMethod: "bank", items: [{ productId: s.iphone.id, quantity: 1, unitPrice: 112000 }] });
    expect((await post(`/sales/${c.body.data.id}/void`, s.t, { reason: "Returned", refundMethod: "bank" })).status).toBe(200);
    await post("/expenses", s.t, { category: "Rent", amount: 1000 });
    // Purchase of 10 chargers (6500), 2000 paid up front, 500 paid later
    const p = await post("/purchases", s.t, { supplierId: s.supplier.id, amountPaid: 2000, paymentMethod: "bank", items: [{ productId: s.charger.id, quantity: 10, unitCost: 650 }] });
    await post(`/purchases/${p.body.data.id}/payments`, s.t, { amount: 500, method: "cash" });

    const r = (await get(`/reports?${RANGE}`, s.t)).body.data;
    expect(r.summary).toMatchObject({
      totalSales: 24000, salesTax: 200, netSales: 23800,
      costOfGoodsSold: 1300 + 17500, grossProfit: 23800 - 18800,
      totalExpenses: 1000, netProfit: 4000,
      totalPayments: 12300, refundsIssued: 112000, outstandingSales: 11700,
      totalPurchases: 6500, purchasePayments: 2500, supplierPaymentsMade: 2500, outstandingPurchases: 4000,
      salesCount: 2, purchaseCount: 1, paymentCount: 2, expenseCount: 1,
    });
    // Product lines are net of their own discount and tax, so they add up to net sales.
    const lines = r.bestSellingProducts.reduce((t: number, x: any) => t + x.grossSales, 0);
    expect(lines).toBe(23800);
    expect(r.paymentMethods.map((m: any) => [m.method, m.amount]).sort()).toEqual([["cash", 2300], ["mpesa", 10000]]);
    expect(await ledgerViolations()).toEqual([]);
  });

  it("sums are free of floating-point error", async () => {
    const s = await seedPhoneShop();
    const pen = await createProduct(s.t, { name: "Pen", costPrice: 0.05, sellingPrice: 0.1, stockQuantity: 100 });
    for (let i = 0; i < 3; i++) {
      await post("/sales", s.t, { amountPaid: 0.1, paymentMethod: "cash", items: [{ productId: pen.id, quantity: 1, unitPrice: 0.1 }] });
    }
    const r = (await get(`/reports?${RANGE}`, s.t)).body.data;
    expect(r.summary.totalSales).toBe(0.3); // 0.1 + 0.1 + 0.1 === 0.30000000000000004 in floats
    expect(r.summary.totalPayments).toBe(0.3);
    expect(r.summary.costOfGoodsSold).toBe(0.15);
  });

  it("validates the date range", async () => {
    const s = await seedPhoneShop();
    for (const q of ["", "startDate=2026-01-01", "startDate=2026-02-30&endDate=2026-03-01", "startDate=2026-05-01&endDate=2026-04-01", "startDate=abc&endDate=def"]) {
      expect((await get(`/reports?${q}`, s.t)).status, q).toBe(400);
    }
  });

  it("a day means the business's day (Africa/Nairobi) even when the server runs in UTC", async () => {
    const s = await seedPhoneShop();
    await post("/sales", s.t, { amountPaid: 1200, paymentMethod: "cash", items: [{ productId: s.charger.id, quantity: 1, unitPrice: 1200 }] });
    // 21:30 UTC on 1 March is 00:30 on 2 March in Nairobi.
    await query(`update sales set sale_date = '2026-03-01T21:30:00Z' where business_id = $1`, [s.t.businessId]);

    const port = cfg.apiPort + 3;
    const utc: RunningServer = startServer(port, { TZ: "UTC" });
    try {
      await waitForHealth(`http://127.0.0.1:${port}/api/health`, 40_000, utc);
      const call = async (d1: string, d2: string) => {
        const res = await fetch(`http://127.0.0.1:${port}/api/reports?startDate=${d1}&endDate=${d2}`, {
          headers: { authorization: `Bearer ${s.t.token}`, "x-business-id": s.t.businessId },
        });
        return (await res.json()).data;
      };
      expect((await call("2026-03-01", "2026-03-01")).summary.salesCount).toBe(0);
      const mar2 = await call("2026-03-02", "2026-03-02");
      expect(mar2.summary.salesCount).toBe(1);
      expect(mar2.trends[0].date).toBe("2026-03-02");
    } finally { await utc.stop(); }
  });

  it("time zone helpers handle offsets and DST", () => {
    expect(startOfDay("2026-03-02", "Africa/Nairobi").toISOString()).toBe("2026-03-01T21:00:00.000Z");
    expect(startOfDay("2026-03-08", "America/New_York").toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(startOfDay("2026-03-09", "America/New_York").toISOString()).toBe("2026-03-09T04:00:00.000Z");
    expect(nextDay("2026-12-31")).toBe("2027-01-01");
    expect(dayKey(new Date("2026-03-01T21:30:00Z"), "Africa/Nairobi", false)).toBe("2026-03-02");
    expect(dayKey(new Date("2026-03-01T21:30:00Z"), "Africa/Nairobi", true)).toBe("2026-03");
    expect(() => startOfDay("2026-02-30", "Africa/Nairobi")).toThrow();
  });

  it("only users with reports.view can read reports (accountant yes, cashier no)", async () => {
    const s = await seedPhoneShop();
    const acct = await addEmployee(s.t, "Accountant");
    const csh = await addEmployee(s.t, "Cashier");
    expect((await get(`/reports?${RANGE}`, acct)).status).toBe(200);
    expect((await get(`/reports?${RANGE}`, csh)).status).toBe(403);
  });
});
