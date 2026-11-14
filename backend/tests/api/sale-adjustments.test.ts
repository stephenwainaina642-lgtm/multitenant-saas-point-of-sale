import { describe, it, expect, beforeAll } from "vitest";
import { query, resetData } from "../support/db.js";
import { get, post, put } from "../support/http.js";
import {
  addEmployee, createProduct, ledgerViolations, seedPhoneShop, stockOf, type Tenant,
} from "../support/seed.js";

const N = (v: unknown) => Number(v);

describe("sale edit, void and refund", () => {
  let s: Awaited<ReturnType<typeof seedPhoneShop>>;
  let manager: Tenant;
  let cashier: Tenant;

  beforeAll(async () => {
    await resetData();
    s = await seedPhoneShop();
    manager = await addEmployee(s.t, "Manager");
    cashier = await addEmployee(s.t, "Cashier");
  });

  const customerBalance = async () =>
    N((await query(`select balance from customers where id = $1`, [s.customer.id]))[0]!.balance);

  /** A KES 2,400 credit sale of 2 chargers with KES 1,000 paid. */
  const creditSale = async (qty = 2, paid = 1000) => {
    const res = await post("/sales", s.t, {
      customerId: s.customer.id, amountPaid: paid, paymentMethod: "cash",
      items: [{ productId: s.charger.id, quantity: qty, unitPrice: 1200 }],
    });
    expect(res.status).toBe(201);
    return res.body.data as { id: string };
  };
  const item = (productId: string, quantity: number, unitPrice: number, extra: object = {}) =>
    ({ productId, quantity, unitPrice, ...extra });
  const sale = async (id: string) => (await get(`/sales/${id}`, s.t)).body.data;

  describe("edit", () => {
    it("increasing quantity charges stock and the customer balance by the difference only", async () => {
      const { id } = await creditSale();
      const stock = await stockOf(s.charger.id);
      const balance = await customerBalance();
      const res = await put(`/sales/${id}`, s.t, { items: [item(s.charger.id, 3, 1200)] });
      expect(res.status).toBe(200);
      expect(N(res.body.data.total)).toBe(3600);
      expect(N(res.body.data.balanceDue)).toBe(2600);
      expect(res.body.data.paymentStatus).toBe("partial");
      expect(await stockOf(s.charger.id)).toBe(stock - 1);
      expect(await customerBalance()).toBe(balance + 1200);
      const mv = await query(`select type, quantity from inventory_movements where reference = $1`, [`SALE-EDIT-${id}`]);
      expect(mv).toEqual([{ type: "OUT", quantity: "1.000" }]);
      expect(await ledgerViolations()).toEqual([]);
    });

    it("decreasing quantity returns stock and lowers the customer balance", async () => {
      const { id } = await creditSale(3, 1000);
      const stock = await stockOf(s.charger.id);
      const balance = await customerBalance();
      const res = await put(`/sales/${id}`, s.t, { items: [item(s.charger.id, 2, 1200)] });
      expect(res.status).toBe(200);
      expect(N(res.body.data.balanceDue)).toBe(1400);
      expect(await stockOf(s.charger.id)).toBe(stock + 1);
      expect(await customerBalance()).toBe(balance - 1200);
      expect(await ledgerViolations()).toEqual([]);
    });

    it("swapping the product moves stock from one to the other", async () => {
      const { id } = await creditSale(1, 500);
      const charger = await stockOf(s.charger.id);
      const galaxy = await stockOf(s.galaxy.id);
      const res = await put(`/sales/${id}`, s.t, { items: [item(s.galaxy.id, 1, 21500)] });
      expect(res.status).toBe(200);
      expect(await stockOf(s.charger.id)).toBe(charger + 1);
      expect(await stockOf(s.galaxy.id)).toBe(galaxy - 1);
      expect(await ledgerViolations()).toEqual([]);
    });

    it("preserves payment history exactly", async () => {
      const { id } = await creditSale(2, 1000);
      await post("/payments", s.t, { saleId: id, amount: 400, method: "mpesa", reference: "R1" });
      const before = await query(`select id, amount, method, reference from payments where sale_id = $1 order by id`, [id]);
      await put(`/sales/${id}`, s.t, { items: [item(s.charger.id, 2, 1200, { discount: 100 })], notes: "edited" });
      const after = await query(`select id, amount, method, reference from payments where sale_id = $1 order by id`, [id]);
      expect(after).toEqual(before);
      const d = await sale(id);
      expect(N(d.amountPaid)).toBe(1400);
      expect(N(d.total)).toBe(2300);
      expect(d.notes).toBe("edited");
      expect(await ledgerViolations()).toEqual([]);
    });

    it("refuses a new total below the amount already paid and changes nothing", async () => {
      const { id } = await creditSale(2, 2000);
      const stock = await stockOf(s.charger.id);
      const balance = await customerBalance();
      const res = await put(`/sales/${id}`, s.t, { items: [item(s.charger.id, 1, 1200)] });
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/lower than the amount already paid/);
      expect(await stockOf(s.charger.id)).toBe(stock);
      expect(await customerBalance()).toBe(balance);
      const d = await sale(id);
      expect(d.items).toHaveLength(1);
      expect(N(d.items[0].quantity)).toBe(2);
    });

    it("insufficient stock on an increase rolls everything back", async () => {
      const { id } = await creditSale(1, 500);
      const stock = await stockOf(s.charger.id);
      const balance = await customerBalance();
      const res = await put(`/sales/${id}`, s.t, { items: [item(s.charger.id, 1 + stock + 1, 1200)] });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Insufficient stock/);
      expect(await stockOf(s.charger.id)).toBe(stock);
      expect(await customerBalance()).toBe(balance);
      expect(N((await sale(id)).total)).toBe(1200);
    });

    it("rejects invalid edits: empty items, balance without customer, bad price", async () => {
      const { id } = await creditSale(1, 500);
      expect((await put(`/sales/${id}`, s.t, { items: [] })).status).toBe(400);
      expect((await put(`/sales/${id}`, s.t, { items: [item(s.charger.id, 1, 999)] })).status).toBe(400);
      const walkIn = await put(`/sales/${id}`, s.t, { customerId: null, items: [item(s.charger.id, 1, 1200)] });
      expect(walkIn.status).toBe(400);
      expect(walkIn.body.message).toBe("A customer is required for a sale with an outstanding balance");
    });

    it("moving a sale to another customer moves the balance with it", async () => {
      const other = await post("/customers", s.t, { name: "Otieno Traders" });
      const { id } = await creditSale(1, 200);
      const before = await customerBalance();
      const res = await put(`/sales/${id}`, s.t, { customerId: other.body.data.id, items: [item(s.charger.id, 1, 1200)] });
      expect(res.status).toBe(200);
      expect(await customerBalance()).toBe(before - 1000);
      const [o] = await query(`select balance from customers where id = $1`, [other.body.data.id]);
      expect(N(o!.balance)).toBe(1000);
      expect(await ledgerViolations()).toEqual([]);
    });

    it("an unchanged line keeps its original price and archived product after the catalogue changes", async () => {
      const p = await createProduct(s.t, { name: "Screen Guard", costPrice: 100, sellingPrice: 500, stockQuantity: 20 });
      const made = await post("/sales", s.t, { customerId: s.customer.id, amountPaid: 500, paymentMethod: "cash", items: [item(p.id, 1, 500)] });
      await query(`update products set selling_price = 650, is_active = false where id = $1`, [p.id]);
      const same = await put(`/sales/${made.body.data.id}`, s.t, { items: [item(p.id, 2, 500)] });
      expect(same.status).toBe(200);
      const wrong = await put(`/sales/${made.body.data.id}`, s.t, { items: [item(p.id, 2, 550)] });
      expect(wrong.status).toBe(400);
    });

    it("records a before/after snapshot in the audit log", async () => {
      const { id } = await creditSale(2, 1000);
      await put(`/sales/${id}`, s.t, { items: [item(s.charger.id, 1, 1200)] });
      const rows = await query(`select action, details, user_id::text as uid from audit_logs where entity = 'sale' and entity_id = $1`, [id]);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.action).toBe("sale.edit");
      expect(rows[0]!.uid).toBe(s.t.userId);
      expect(rows[0]!.details.before.total).toBe("2400");
      expect(rows[0]!.details.after.total).toBe("1200");
    });

    it("a payment still works after an edit and the ledger stays consistent", async () => {
      const { id } = await creditSale(2, 1000);
      await put(`/sales/${id}`, s.t, { items: [item(s.charger.id, 3, 1200)] });
      const pay = await post("/payments", s.t, { saleId: id, amount: 2600, method: "mpesa" });
      expect(pay.status).toBe(201);
      expect(pay.body.data.sale.paymentStatus).toBe("paid");
      expect(await ledgerViolations()).toEqual([]);
    });

    it("permissions: owner and manager may edit; cashier may not; unknown sale is 404", async () => {
      const { id } = await creditSale(1, 500);
      expect((await put(`/sales/${id}`, cashier, { items: [item(s.charger.id, 1, 1200)] })).status).toBe(403);
      expect((await put(`/sales/${id}`, manager, { items: [item(s.charger.id, 1, 1200)] })).status).toBe(200);
      expect((await put(`/sales/999999`, s.t, { items: [item(s.charger.id, 1, 1200)] })).status).toBe(404);
      expect((await put(`/sales/abc`, s.t, { items: [item(s.charger.id, 1, 1200)] })).status).toBe(404);
    });

    it("an employee with sales.edit but no view-all can only edit their own sales", async () => {
      const editor = await addEmployee(s.t, "Till Editor", ["sales.create", "sales.view_own", "sales.edit", "products.view"]);
      const mine = await post("/sales", editor, { customerId: s.customer.id, amountPaid: 100, paymentMethod: "cash", items: [item(s.charger.id, 1, 1200)] });
      const { id: others } = await creditSale(1, 100);
      expect((await put(`/sales/${mine.body.data.id}`, editor, { items: [item(s.charger.id, 2, 1200)] })).status).toBe(200);
      expect((await put(`/sales/${others}`, editor, { items: [item(s.charger.id, 2, 1200)] })).status).toBe(404);
    });
  });

  describe("void and refund", () => {
    it("voiding an unpaid credit sale restores stock and clears the customer balance", async () => {
      const made = await post("/sales", s.t, { customerId: s.customer.id, items: [item(s.charger.id, 2, 1200)] });
      const id = made.body.data.id;
      const stock = await stockOf(s.charger.id);
      const balance = await customerBalance();
      const res = await post(`/sales/${id}/void`, s.t, { reason: "Customer changed mind" });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("voided");
      expect(res.body.data.refund).toBeNull();
      expect(await stockOf(s.charger.id)).toBe(stock + 2);
      expect(await customerBalance()).toBe(balance - 2400);
      const mv = await query(`select type, quantity from inventory_movements where reference = $1`, [`SALE-VOID-${id}`]);
      expect(mv).toEqual([{ type: "IN", quantity: "2.000" }]);
      expect(await ledgerViolations()).toEqual([]);
    });

    it("voiding a paid sale requires a reason and a refund method, and records the refund separately", async () => {
      const made = await post("/sales", s.t, { amountPaid: 21500, paymentMethod: "mpesa", items: [item(s.galaxy.id, 1, 21500)] });
      const id = made.body.data.id;
      expect((await post(`/sales/${id}/void`, s.t, {})).status).toBe(400);
      const noMethod = await post(`/sales/${id}/void`, s.t, { reason: "Faulty" });
      expect(noMethod.status).toBe(400);
      expect(noMethod.body.message).toMatch(/refund method/);
      expect(N((await sale(id)).amountPaid)).toBe(21500); // nothing changed yet

      const res = await post(`/sales/${id}/void`, s.t, { reason: "Faulty phone", refundMethod: "mpesa", refundReference: "REF99" });
      expect(res.status).toBe(200);
      expect(N(res.body.data.refund.amount)).toBe(21500);
      expect(res.body.data.paymentStatus).toBe("refunded");

      const d = await sale(id);
      expect(d.status).toBe("voided");
      expect(d.payments).toHaveLength(1);          // payment history untouched
      expect(N(d.payments[0].amount)).toBe(21500);
      expect(d.refunds).toHaveLength(1);
      expect(d.refunds[0].reason).toBe("Faulty phone");
      expect(await ledgerViolations()).toEqual([]);
    });

    it("a voided sale cannot be voided again, edited or paid, and stock is restored only once", async () => {
      const made = await post("/sales", s.t, { customerId: s.customer.id, items: [item(s.charger.id, 1, 1200)] });
      const id = made.body.data.id;
      await post(`/sales/${id}/void`, s.t, { reason: "Error" });
      const stock = await stockOf(s.charger.id);
      expect((await post(`/sales/${id}/void`, s.t, { reason: "Again" })).status).toBe(409);
      expect((await put(`/sales/${id}`, s.t, { items: [item(s.charger.id, 1, 1200)] })).status).toBe(409);
      expect((await post("/payments", s.t, { saleId: id, amount: 100, method: "cash" })).status).toBe(409);
      expect(await stockOf(s.charger.id)).toBe(stock);
    });

    it("writes a void audit entry with the reason and refund", async () => {
      const made = await post("/sales", s.t, { amountPaid: 1200, paymentMethod: "cash", items: [item(s.charger.id, 1, 1200)] });
      await post(`/sales/${made.body.data.id}/void`, s.t, { reason: "Wrong item", refundMethod: "cash" });
      const [row] = await query(`select action, details from audit_logs where entity = 'sale' and entity_id = $1`, [made.body.data.id]);
      expect(row!.action).toBe("sale.void");
      expect(row!.details).toMatchObject({ reason: "Wrong item", refunded: "1200", refundMethod: "cash" });
    });

    it("permissions: only roles with sales.void may void; a cashier cannot", async () => {
      const made = await post("/sales", s.t, { amountPaid: 1200, paymentMethod: "cash", items: [item(s.charger.id, 1, 1200)] });
      const id = made.body.data.id;
      expect((await post(`/sales/${id}/void`, cashier, { reason: "x", refundMethod: "cash" })).status).toBe(403);
      expect((await post(`/sales/${id}/void`, manager, { reason: "Manager decision", refundMethod: "cash" })).status).toBe(200);
    });

    it("voided sales drop out of reports", async () => {
      const t = await seedPhoneShop();
      const made = await post("/sales", t.t, { amountPaid: 21500, paymentMethod: "cash", items: [item(t.galaxy.id, 1, 21500)] });
      const url = "/reports?startDate=2026-01-01&endDate=2026-12-31";
      const before = JSON.stringify((await get(url, t.t)).body);
      expect(before).toContain("21500");
      await post(`/sales/${made.body.data.id}/void`, t.t, { reason: "Test", refundMethod: "cash" });
      const after = JSON.stringify((await get(url, t.t)).body);
      expect(after).not.toContain(made.body.data.receiptNumber);
      expect(after).not.toEqual(before);
    });
  });
});
