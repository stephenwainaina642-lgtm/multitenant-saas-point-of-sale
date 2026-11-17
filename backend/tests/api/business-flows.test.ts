/**
 * Stage 4: whole-business scenarios through the real API, several modules and roles at once.
 * Every expected figure is worked out by hand in the comments, not read back from the system.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { query, resetData } from "../support/db.js";
import { get, post, put } from "../support/http.js";
import { addEmployee, ledgerViolations, seedHardwareStore, seedPhoneShop, seedWholesaler, stockOf, mpesaCode } from "../support/seed.js";

const RANGE = "startDate=2026-01-01&endDate=2026-12-31";
const line = (productId: string, quantity: number, unitPrice: number, extra: object = {}) => ({ productId, quantity, unitPrice, ...extra });

describe("a phone shop trading day with an owner, cashier, manager and accountant", () => {
  beforeAll(resetData);

  it("sells, collects, buys, pays, voids and reports to the shilling", async () => {
    const s = await seedPhoneShop();       // iphone 5 @98000/112000, galaxy 12 @17500/21500, charger 40 @650/1200
    const cashier = await addEmployee(s.t, "Cashier");
    const manager = await addEmployee(s.t, "Manager");
    const accountant = await addEmployee(s.t, "Accountant");

    // Owner restocks 20 chargers: 13,000, 5,000 paid now.
    const purchase = (await post("/purchases", s.t, { supplierId: s.supplier.id, amountPaid: 5000, paymentMethod: "bank", items: [{ productId: s.charger.id, quantity: 20, unitCost: 650 }] })).body.data;

    // Cashier: 5 chargers cash = 6,000.
    const sale1 = await post("/sales", cashier, { amountPaid: 6000, paymentMethod: "cash", items: [line(s.charger.id, 5, 1200)] });
    expect(sale1.status).toBe(201);
    // Cashier: 2 Galaxy on credit to the customer = 43,000, 20,000 up front.
    const sale2 = (await post("/sales", cashier, { customerId: s.customer.id, amountPaid: 20000, paymentMethod: "mpesa", paymentReference: mpesaCode(), items: [line(s.galaxy.id, 2, 21500)] })).body.data;
    // Customer settles 13,000 later -> 10,000 still owed on this sale.
    expect((await post("/payments", cashier, { saleId: sale2.id, amount: 13000, method: "cash" })).status).toBe(201);

    // Quotation 112,000 + 2 x 1,200 = 114,400 -> sent -> accepted -> converted by the manager.
    const q = (await post("/quotations", manager, { customerId: s.customer.id, items: [line(s.iphone.id, 1, 112000), line(s.charger.id, 2, 1200)] })).body.data;
    expect((await post(`/quotations/${q.id}/status`, manager, { status: "sent" })).status).toBe(200);
    expect((await post(`/quotations/${q.id}/status`, manager, { status: "accepted" })).status).toBe(200);
    const sale3 = (await post(`/quotations/${q.id}/convert`, manager, {})).body.data.sale;
    expect(await stockOf(s.iphone.id)).toBe(4);
    const inv = await post("/invoices", manager, { saleId: sale3.id });
    expect(inv.status).toBe(201);
    expect((await post("/payments", manager, { saleId: sale3.id, amount: 114400, method: "bank" })).status).toBe(201);

    // A mistaken 1,200 charger sale: the cashier is not allowed to void it, the manager is.
    const sale4 = (await post("/sales", cashier, { amountPaid: 1200, paymentMethod: "cash", items: [line(s.charger.id, 1, 1200)] })).body.data;
    expect((await post(`/sales/${sale4.id}/void`, cashier, { reason: "Wrong item", refundMethod: "cash" })).status).toBe(403);
    expect((await post(`/sales/${sale4.id}/void`, manager, { reason: "Wrong item", refundMethod: "cash" })).status).toBe(200);

    // Accountant books rent; owner pays the supplier the remaining 8,000; one charger written off as damaged.
    expect((await post("/expenses", accountant, { category: "Rent", amount: 15000 })).status).toBe(201);
    expect((await post(`/purchases/${purchase.id}/payments`, s.t, { amount: 8000, method: "mpesa" })).status).toBe(201);
    expect((await post("/inventory", s.t, { productId: s.charger.id, type: "OUT", quantity: 1, notes: "Damaged" })).status).toBe(201);

    // Roles hold at the end of the day too.
    expect((await get(`/reports?${RANGE}`, cashier)).status).toBe(403);
    expect((await post("/sales", accountant, { amountPaid: 1200, paymentMethod: "cash", items: [line(s.charger.id, 1, 1200)] })).status).toBe(403);

    // Stock: charger 40+20-5-2-1(sold and voided: back)-1 damaged = 52; galaxy 12-2 = 10; iphone 4.
    expect(await stockOf(s.charger.id)).toBe(52);
    expect(await stockOf(s.galaxy.id)).toBe(10);
    expect(await stockOf(s.iphone.id)).toBe(4);

    // Sales 6,000 + 43,000 + 114,400 = 163,400 (the voided one is excluded).
    // COGS 5x650 + 2x17,500 + 98,000 + 2x650 = 3,250 + 35,000 + 99,300 = 137,550 -> gross profit 25,850; rent 15,000 -> net 10,850.
    // Money in: 6,000 + 33,000 + 114,400 + 1,200 = 154,600, of which 1,200 was refunded. Owed by customer: 10,000.
    for (const who of [s.t, accountant]) {
      const r = (await get(`/reports?${RANGE}`, who)).body.data;
      expect(r.summary).toMatchObject({
        totalSales: 163400, netSales: 163400, costOfGoodsSold: 137550, grossProfit: 25850,
        totalExpenses: 15000, netProfit: 10850,
        totalPayments: 154600, refundsIssued: 1200, outstandingSales: 10000,
        totalPurchases: 13000, purchasePayments: 13000, supplierPaymentsMade: 13000, outstandingPurchases: 0,
        salesCount: 3,
      });
    }

    // The dashboard agrees with the reports and the shelves: stock value 52x650 + 10x17,500 + 4x98,000.
    const d = (await get("/dashboard", s.t)).body.data;
    expect(d.sales.allTime).toEqual({ count: 3, revenue: 163400 });
    expect(d.receivables).toEqual({ outstanding: 10000, unpaidSales: 1 });
    expect(d.payables).toEqual({ outstanding: 0, unpaidPurchases: 0 });
    expect(d.stock).toMatchObject({ units: 66, value: 600800 });

    // Customer and supplier balances match what is really owed.
    expect(Number((await query(`select balance from customers where id = $1`, [s.customer.id]))[0]!.balance)).toBe(10000);
    expect(Number((await query(`select balance from suppliers where id = $1`, [s.supplier.id]))[0]!.balance)).toBe(0);
    expect(await ledgerViolations()).toEqual([]);
  });
});

describe("a hardware store selling by the metre and litre", () => {
  beforeAll(resetData);

  it("keeps fractional quantities and cents exact from sale to report", async () => {
    const s = await seedHardwareStore();   // cement 200 bags, pipe 150.5 m @420, paint 80 l @760
    // 12.345 m pipe = 5,184.90; 17 cement at 780 less 60 discount = 13,200; 3.5 l paint = 2,660 -> 21,044.90, 5,000.15 paid.
    const big = await post("/sales", s.t, {
      customerId: s.customer.id, amountPaid: 5000.15, paymentMethod: "mpesa", paymentReference: mpesaCode(),
      items: [line(s.pipe.id, 12.345, 420), line(s.cement.id, 17, 780, { discount: 60 }), line(s.paint.id, 3.5, 760)],
    });
    expect(big.status, JSON.stringify(big.body)).toBe(201);
    expect(Number(big.body.data.total)).toBe(21044.9);
    expect(Number(big.body.data.balanceDue)).toBe(16044.75);
    // 0.333 l paint = 253.08, paid in full.
    expect((await post("/sales", s.t, { amountPaid: 253.08, paymentMethod: "cash", items: [line(s.paint.id, 0.333, 760)] })).status).toBe(201);
    // 33.333 m pipe at 305.50 = 10,183.2315 -> 10,183.23 (half-up), 10,000 paid.
    const buy = await post("/purchases", s.t, { supplierId: s.supplier.id, amountPaid: 10000, paymentMethod: "bank", items: [{ productId: s.pipe.id, quantity: 33.333, unitCost: 305.5 }] });
    expect(buy.status, JSON.stringify(buy.body)).toBe(201);
    expect(Number(buy.body.data.total)).toBe(10183.23);

    // pipe 150.5 - 12.345 + 33.333 = 171.488; paint 80 - 3.5 - 0.333 = 76.167; cement 200 - 17 = 183.
    expect(await stockOf(s.pipe.id)).toBe(171.488);
    expect(await stockOf(s.paint.id)).toBe(76.167);
    expect(await stockOf(s.cement.id)).toBe(183);

    const r = (await get(`/reports?${RANGE}`, s.t)).body.data.summary;
    expect(r).toMatchObject({
      totalSales: 21297.98,                       // 21,044.90 + 253.08
      totalPayments: 5253.23,                     // 5,000.15 + 253.08
      outstandingSales: 16044.75,
      totalPurchases: 10183.23, purchasePayments: 10000, outstandingPurchases: 183.23,
    });
    expect(Number((await query(`select balance from customers where id = $1`, [s.customer.id]))[0]!.balance)).toBe(16044.75);
    expect(Number((await query(`select balance from suppliers where id = $1`, [s.supplier.id]))[0]!.balance)).toBe(183.23);
    expect(await ledgerViolations()).toEqual([]);
  });
});

describe("two businesses trading at the same time", () => {
  beforeAll(resetData);

  it("never leak into each other and keep every ledger clean", async () => {
    const a = await seedPhoneShop();
    const b = await seedWholesaler();      // sugar 300 @6900, rice 150 @3900
    const work = async (n: number) => {
      await post("/sales", a.t, { amountPaid: 1200, paymentMethod: "cash", items: [line(a.charger.id, 1, 1200)] });
      await post("/sales", b.t, { customerId: b.customer.id, amountPaid: 0, items: [line(b.sugar.id, 2, 6900)] });
      await post("/purchases", a.t, { supplierId: a.supplier.id, amountPaid: 0, items: [line(a.charger.id, 1, 650)].map(({ productId, quantity }) => ({ productId, quantity, unitCost: 650 })) });
      await post("/expenses", b.t, { category: "Transport", amount: 100 + n });
    };
    await Promise.all(Array.from({ length: 6 }, (_, i) => work(i)));

    // A: 6 chargers sold for 7,200; 6 bought for 3,900 (all owed). B: 12 sugar sacks = 82,800 on credit; expenses 100..105 = 615.
    const da = (await get("/dashboard", a.t)).body.data;
    const db = (await get("/dashboard", b.t)).body.data;
    expect(da.sales.allTime).toEqual({ count: 6, revenue: 7200 });
    expect(da.payables).toEqual({ outstanding: 3900, unpaidPurchases: 6 });
    expect(db.sales.allTime).toEqual({ count: 6, revenue: 82800 });
    expect(db.receivables).toEqual({ outstanding: 82800, unpaidSales: 6 });
    expect(db.stock.units).toBe(300 - 12 + 150);
    expect((await get(`/reports?${RANGE}`, b.t)).body.data.summary).toMatchObject({ totalExpenses: 615, totalSales: 82800 });

    // One business cannot read or change the other's records.
    const aSale = (await get("/sales", a.t)).body.data[0];
    expect((await get(`/sales/${aSale.id}`, b.t)).status).toBe(404);
    expect((await post(`/sales/${aSale.id}/void`, b.t, { reason: "x", refundMethod: "cash" })).status).toBe(404);
    expect((await put(`/sales/${aSale.id}`, b.t, { items: [line(b.sugar.id, 1, 6900)] })).status).toBe(404);
    expect(await ledgerViolations()).toEqual([]);
  });
});
