import { describe, it, expect, beforeAll } from "vitest";
import { query, resetData } from "../support/db.js";
import { api, get, post } from "../support/http.js";
import {
  createProduct, ledgerViolations, registerTenant,
  seedHardwareStore, seedPerfumeBusiness, seedPhoneShop, seedWholesaler, stockOf,
} from "../support/seed.js";

describe("sales, stock and payments", () => {
  beforeAll(resetData);

  describe("phone shop: checkout, stock, movements, payments", () => {
    let s: Awaited<ReturnType<typeof seedPhoneShop>>;
    beforeAll(async () => { s = await seedPhoneShop(); });

    it("full cash sale: totals, stock deduction, OUT movement, payment row", async () => {
      const before = await stockOf(s.iphone.id);
      const res = await post("/sales", s.t, {
        customerId: s.customer.id, amountPaid: 224000, paymentMethod: "Cash",
        items: [{ productId: s.iphone.id, quantity: 2, unitPrice: 112000 }],
      });
      expect(res.status).toBe(201);
      const sale = res.body.data;
      expect(Number(sale.total)).toBe(224000);
      expect(Number(sale.balanceDue)).toBe(0);
      expect(sale.paymentStatus).toBe("paid");
      expect(await stockOf(s.iphone.id)).toBe(before - 2);

      const mv = await query(`select type, quantity from inventory_movements where reference = $1`, [`SALE-${sale.id}`]);
      expect(mv).toEqual([{ type: "OUT", quantity: "2.000" }]);
      const pay = await query(`select amount, method from payments where sale_id = $1`, [sale.id]);
      expect(pay).toEqual([{ amount: "224000.00", method: "cash" }]);
      expect(await ledgerViolations()).toEqual([]);
    });

    it("partial payment then settlement keeps amount_paid == sum(payments)", async () => {
      const res = await post("/sales", s.t, {
        customerId: s.customer.id, amountPaid: 5000, paymentMethod: "mpesa",
        items: [{ productId: s.galaxy.id, quantity: 1, unitPrice: 21500 }],
      });
      expect(res.status).toBe(201);
      const id = res.body.data.id;
      expect(res.body.data.paymentStatus).toBe("partial");

      const p1 = await post("/payments", s.t, { saleId: id, amount: 10000, method: "mpesa", reference: "QWE123ABC" });
      expect(p1.status).toBe(201);
      expect(p1.body.data.sale.paymentStatus).toBe("partial");
      expect(Number(p1.body.data.sale.balanceDue)).toBe(6500);

      const p2 = await post("/payments", s.t, { saleId: id, amount: 6500, method: "cash" });
      expect(p2.body.data.sale.paymentStatus).toBe("paid");

      const detail = await get(`/sales/${id}`, s.t);
      expect(detail.body.data.payments).toHaveLength(3);
      expect(await ledgerViolations()).toEqual([]);
    });

    it("rejects overpayment, zero/negative payment and payment on a settled sale", async () => {
      const sale = await post("/sales", s.t, {
        customerId: s.customer.id, amountPaid: 500, paymentMethod: "cash",
        items: [{ productId: s.charger.id, quantity: 1, unitPrice: 1200 }],
      });
      const id = sale.body.data.id;
      expect((await post("/payments", s.t, { saleId: id, amount: 701, method: "cash" })).status).toBe(400);
      expect((await post("/payments", s.t, { saleId: id, amount: 0, method: "cash" })).status).toBe(400);
      expect((await post("/payments", s.t, { saleId: id, amount: -5, method: "cash" })).status).toBe(400);
      expect((await post("/payments", s.t, { saleId: id, amount: 100, method: "" })).status).toBe(400);
      await post("/payments", s.t, { saleId: id, amount: 700, method: "cash" });
      expect((await post("/payments", s.t, { saleId: id, amount: 1, method: "cash" })).status).toBe(400);
      expect(await ledgerViolations()).toEqual([]);
    });

    it("insufficient stock is rejected and nothing is persisted (rollback)", async () => {
      const stock = await stockOf(s.iphone.id);
      const salesBefore = await query(`select count(*)::int as n from sales`);
      const payBefore = await query(`select count(*)::int as n from payments`);
      const res = await post("/sales", s.t, {
        amountPaid: 100, paymentMethod: "cash",
        items: [{ productId: s.iphone.id, quantity: stock + 1, unitPrice: 112000 }],
      });
      expect(res.status).toBe(400);
      expect(await stockOf(s.iphone.id)).toBe(stock);
      expect(await query(`select count(*)::int as n from sales`)).toEqual(salesBefore);
      expect(await query(`select count(*)::int as n from payments`)).toEqual(payBefore);
    });

    it("a failing second line rolls back the first line's stock deduction", async () => {
      const stock = await stockOf(s.charger.id);
      const res = await post("/sales", s.t, {
        items: [
          { productId: s.charger.id, quantity: 1, unitPrice: 1200 },
          { productId: s.iphone.id, quantity: 9999, unitPrice: 112000 },
        ],
      });
      expect(res.status).toBe(400);
      expect(await stockOf(s.charger.id)).toBe(stock);
    });

    it("the same product on two lines cannot oversell stock", async () => {
      const p = await createProduct(s.t, { name: "Limited Edition Case", costPrice: 100, sellingPrice: 500, stockQuantity: 3 });
      const res = await post("/sales", s.t, {
        items: [
          { productId: p.id, quantity: 2, unitPrice: 500 },
          { productId: p.id, quantity: 2, unitPrice: 500 },
        ],
      });
      expect(res.status).toBe(400);
      expect(await stockOf(p.id)).toBe(3);
    });

    it("validates input: empty cart, price mismatch, negatives, overpaying, missing method", async () => {
      const item = { productId: s.charger.id, quantity: 1, unitPrice: 1200 };
      expect((await post("/sales", s.t, { items: [] })).status).toBe(400);
      expect((await post("/sales", s.t, { items: [{ ...item, unitPrice: 900 }] })).status).toBe(400);
      expect((await post("/sales", s.t, { items: [{ ...item, quantity: -1 }] })).status).toBe(400);
      expect((await post("/sales", s.t, { items: [{ ...item, quantity: 0 }] })).status).toBe(400);
      expect((await post("/sales", s.t, { items: [item], discount: -1 })).status).toBe(400);
      expect((await post("/sales", s.t, { items: [item], amountPaid: 5000, paymentMethod: "cash" })).status).toBe(400);
      expect((await post("/sales", s.t, { items: [item], amountPaid: 100 })).status).toBe(400);
      expect((await post("/sales", s.t, { items: [{ ...item, productId: "999999" }] })).status).toBe(404);
      // a balance cannot be left on an anonymous (walk-in) sale
      const walkIn = await post("/sales", s.t, { items: [item] });
      expect(walkIn.status).toBe(400);
      expect(walkIn.body.message).toBe("A customer is required for a sale with an outstanding balance");
      // more than 2 decimal places of money is refused instead of silently rounded
      expect((await post("/sales", s.t, { items: [{ ...item, unitPrice: 1200.005 }] })).status).toBe(400);
    });

    it("sale-level discount and tax feed into the total", async () => {
      const res = await post("/sales", s.t, {
        discount: 200, tax: 160, amountPaid: 1160, paymentMethod: "cash",
        items: [{ productId: s.charger.id, quantity: 1, unitPrice: 1200 }],
      });
      expect(res.status).toBe(201);
      expect(Number(res.body.data.total)).toBe(1160);
      expect(res.body.data.paymentStatus).toBe("paid");
    });

    it("salesperson attribution: sales are stamped with the logged-in user", async () => {
      const res = await post("/sales", s.t, {
        amountPaid: 1200, paymentMethod: "cash",
        items: [{ productId: s.charger.id, quantity: 1, unitPrice: 1200 }],
      });
      const [row] = await query(`select salesperson_id::text as sp from sales where id = $1`, [res.body.data.id]);
      expect(row!.sp).toBe(s.t.userId);
    });
  });

  describe("money, discounts, decimals and customer credit (fixed in Stage 2b-1)", () => {
    it("item-level discount is included in the sale total", async () => {
      const s = await seedPerfumeBusiness();
      const res = await post("/sales", s.t, {
        amountPaid: 3500, paymentMethod: "cash",
        items: [{ productId: s.amber.id, quantity: 1, unitPrice: 3800, discount: 300 }],
      });
      expect(res.status).toBe(201);
      expect(Number(res.body.data.total)).toBe(3500);
      expect(Number(res.body.data.discount)).toBe(300);
      expect(Number(res.body.data.subtotal) - Number(res.body.data.discount) + Number(res.body.data.tax)).toBe(3500);
    });

    it("item-level tax is included in the sale total", async () => {
      const s = await seedPerfumeBusiness();
      const res = await post("/sales", s.t, {
        amountPaid: 1044, paymentMethod: "cash",
        items: [{ productId: s.oud6.id, quantity: 1, unitPrice: 900, tax: 144 }],
      });
      expect(res.status).toBe(201);
      expect(Number(res.body.data.total)).toBe(1044);
    });

    it("floating point: 3 x 100.01 paid in full is marked 'paid'", async () => {
      const t = await registerTenant("Float Shop");
      const p = await createProduct(t, { name: "Per-metre cable", costPrice: 50, sellingPrice: 100.01, stockQuantity: 50 });
      const res = await post("/sales", t, {
        amountPaid: 300.03, paymentMethod: "cash",
        items: [{ productId: p.id, quantity: 3, unitPrice: 100.01 }],
      });
      expect(res.status).toBe(201);
      expect(res.body.data.paymentStatus).toBe("paid");
    });

    it("hardware: decimal quantity (2.5 m of pipe) can be sold", async () => {
      const s = await seedHardwareStore();
      const res = await post("/sales", s.t, {
        amountPaid: 1050, paymentMethod: "cash",
        items: [{ productId: s.pipe.id, quantity: 2.5, unitPrice: 420 }],
      });
      expect(res.status).toBe(201);
      expect(await stockOf(s.pipe.id)).toBeCloseTo(148, 3);
    });

    it("a credit sale increases the customer's balance", async () => {
      const s = await seedWholesaler();
      const res = await post("/sales", s.t, {
        customerId: s.customer.id,
        items: [{ productId: s.sugar.id, quantity: 10, unitPrice: 6900 }],
      });
      expect(res.status).toBe(201);
      const [c] = await query(`select balance from customers where id = $1`, [s.customer.id]);
      expect(Number(c!.balance)).toBe(69000);
    });

    it("a credit sale above the customer's credit limit is rejected", async () => {
      const s = await seedWholesaler();
      await query(`update customers set credit_limit = 10000 where id = $1`, [s.customer.id]);
      const res = await post("/sales", s.t, {
        customerId: s.customer.id,
        items: [{ productId: s.sugar.id, quantity: 10, unitPrice: 6900 }],
      });
      expect(res.status).toBe(400);
      expect(res.body.message).toBe("Credit limit exceeded for customer: Mama Njeri Mini-Mart");
    });

    it("customer balance follows sales and payments exactly", async () => {
      const s = await seedWholesaler();
      const sale = await post("/sales", s.t, {
        customerId: s.customer.id, amountPaid: 9000, paymentMethod: "cash",
        items: [{ productId: s.sugar.id, quantity: 2, unitPrice: 6900 }],
      });
      expect(sale.status).toBe(201);
      const bal = async () => Number((await query(`select balance from customers where id = $1`, [s.customer.id]))[0]!.balance);
      expect(await bal()).toBe(4800);
      await post("/payments", s.t, { saleId: sale.body.data.id, amount: 1800, method: "mpesa" });
      expect(await bal()).toBe(3000);
      await post("/payments", s.t, { saleId: sale.body.data.id, amount: 3000, method: "mpesa" });
      expect(await bal()).toBe(0);
      expect(await ledgerViolations()).toEqual([]);
    });

    it("quantity x price rounds half-up to the cent (0.333 x 100.01)", async () => {
      const t = await registerTenant("Rounding Shop");
      const p = await createProduct(t, { name: "By the metre", costPrice: 50, sellingPrice: 100.01, stockQuantity: 10, unitOfMeasure: "metre" });
      const res = await post("/sales", t, {
        amountPaid: 33.3, paymentMethod: "cash",
        items: [{ productId: p.id, quantity: 0.333, unitPrice: 100.01 }],
      });
      expect(res.status).toBe(201);
      expect(Number(res.body.data.total)).toBe(33.3); // 33.30333 -> 33.30
      expect(res.body.data.paymentStatus).toBe("paid");
      expect((await post("/sales", t, { amountPaid: 1, paymentMethod: "cash", items: [{ productId: p.id, quantity: 0.0004, unitPrice: 100.01 }] })).status).toBe(400);
    });
  });

  describe("receipt numbers and duplicate submissions", () => {
    it("receipt numbers are sequential per business and independent between businesses", async () => {
      const a = await seedPhoneShop();
      const b = await seedHardwareStore();
      const sell = (t: typeof a.t, productId: string, price: number) =>
        post("/sales", t, { amountPaid: price, paymentMethod: "cash", items: [{ productId, quantity: 1, unitPrice: price }] });
      const a1 = await sell(a.t, a.charger.id, 1200);
      const a2 = await sell(a.t, a.charger.id, 1200);
      const b1 = await sell(b.t, b.cement.id, 780);
      expect(a1.body.data.receiptNumber).toBe("RCT-000001");
      expect(a2.body.data.receiptNumber).toBe("RCT-000002");
      expect(b1.body.data.receiptNumber).toBe("RCT-000001");
    });

    it("a repeated sale submission with the same Idempotency-Key creates one sale", async () => {
      const s = await seedPhoneShop();
      const stock = await stockOf(s.galaxy.id);
      const body = { amountPaid: 21500, paymentMethod: "cash", items: [{ productId: s.galaxy.id, quantity: 1, unitPrice: 21500 }] };
      const first = await api("POST", "/sales", { session: s.t, body, headers: { "idempotency-key": "till-1-0001" } });
      const again = await api("POST", "/sales", { session: s.t, body, headers: { "idempotency-key": "till-1-0001" } });
      expect(first.status).toBe(201);
      expect(again.status).toBe(201);
      expect(again.body.data.id).toBe(first.body.data.id);
      expect(again.body.data.idempotentReplay).toBe(true);
      expect(await stockOf(s.galaxy.id)).toBe(stock - 1);
      const n = await query(`select count(*)::int as n from sales where idempotency_key = 'till-1-0001'`);
      expect(n[0]!.n).toBe(1);
    });

    it("a repeated payment submission with the same Idempotency-Key records one payment", async () => {
      const s = await seedPhoneShop();
      const sale = await post("/sales", s.t, { customerId: s.customer.id, items: [{ productId: s.galaxy.id, quantity: 1, unitPrice: 21500 }] });
      const body = { saleId: sale.body.data.id, amount: 5000, method: "mpesa", reference: "ABC1" };
      const h = { "idempotency-key": "pay-0001" };
      const r1 = await api("POST", "/payments", { session: s.t, body, headers: h });
      const r2 = await api("POST", "/payments", { session: s.t, body, headers: h });
      expect(r1.status).toBe(201);
      expect(r2.status).toBe(201);
      expect(r2.body.data.idempotentReplay).toBe(true);
      expect(Number(r2.body.data.sale.amountPaid)).toBe(5000);
      const other = await api("POST", "/payments", { session: s.t, body: { ...body, saleId: "999999" }, headers: h });
      expect(other.status).toBe(409);
      expect(await ledgerViolations()).toEqual([]);
    });
  });

  describe("current behaviour that blocks real-world use (documented, not yet a fix target)", () => {
    it("CURRENT: a price different from the saved selling price is rejected (no wholesale or negotiated price)", async () => {
      const s = await seedWholesaler();
      const res = await post("/sales", s.t, {
        items: [{ productId: s.sugar.id, quantity: 1, unitPrice: 6500 }],
      });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/does not match the saved selling price/);
    });

    it("CURRENT: there is no endpoint to edit, void or return a sale", async () => {
      const s = await seedPhoneShop();
      const sale = await post("/sales", s.t, { amountPaid: 1200, paymentMethod: "cash", items: [{ productId: s.charger.id, quantity: 1, unitPrice: 1200 }] });
      const id = sale.body.data.id;
      for (const [method, path] of [["PUT", `/sales/${id}`], ["PATCH", `/sales/${id}`], ["DELETE", `/sales/${id}`], ["POST", `/sales/${id}/void`], ["POST", `/sales/${id}/return`]] as const) {
        const res = await fetch(`http://127.0.0.1:${process.env.TEST_API_PORT || 5599}/api${path}`, {
          method,
          headers: { authorization: `Bearer ${s.t.token}`, "x-business-id": s.t.businessId, "content-type": "application/json" },
          body: method === "DELETE" ? null : "{}",
        });
        expect(res.status, `${method} ${path}`).toBe(404);
      }
    });
  });
});
