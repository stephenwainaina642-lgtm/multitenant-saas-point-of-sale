import { describe, it, expect, beforeAll } from "vitest";
import { resetData } from "../support/db.js";
import { get, post, put } from "../support/http.js";
import { addEmployee, registerTenant, seedPhoneShop, type Tenant } from "../support/seed.js";

const N = (v: unknown) => Number(v);

describe("invoices", () => {
  let s: Awaited<ReturnType<typeof seedPhoneShop>>;
  let other: Tenant;
  beforeAll(async () => { await resetData(); s = await seedPhoneShop(); other = await registerTenant("Other"); });

  const sale = async (paid = 1000, qty = 2) =>
    (await post("/sales", s.t, {
      customerId: s.customer.id, amountPaid: paid, ...(paid > 0 && { paymentMethod: "cash" }),
      items: [{ productId: s.charger.id, quantity: qty, unitPrice: 1200 }],
    })).body.data as { id: string };
  const invoice = async (saleId: string, extra: object = {}) => post("/invoices", s.t, { saleId, ...extra });

  it("creates invoices with sequential numbers and copies the sale", async () => {
    const a = await invoice((await sale()).id);
    const b = await invoice((await sale()).id);
    expect(a.status).toBe(201);
    expect(a.body.data.invoiceNumber).toBe("INV-000001");
    expect(b.body.data.invoiceNumber).toBe("INV-000002");
    expect(a.body.data).toMatchObject({ status: "partial", customerName: "Wanjiku Kamau" });
    expect(N(a.body.data.total)).toBe(2400);
    expect(N(a.body.data.balanceDue)).toBe(1400);
    expect(a.body.data.items).toHaveLength(1);
  });

  it("a sale can only be invoiced once; manual numbers must be unique; auto numbering skips taken ones", async () => {
    const sl = await sale();
    expect((await invoice(sl.id, { invoiceNumber: "INV-000003" })).status).toBe(201);
    expect((await invoice(sl.id)).status).toBe(409);
    const sl2 = await sale();
    expect((await invoice(sl2.id, { invoiceNumber: "INV-000003" })).status).toBe(409);
    const auto = await invoice(sl2.id); // sequence would hand out 000003, which is taken
    expect(auto.body.data.invoiceNumber).toBe("INV-000004");
  });

  it("always shows the sale's current figures: payments, edits and voids flow through", async () => {
    const sl = await sale(1000, 2);
    const inv = (await invoice(sl.id)).body.data;
    expect(inv.status).toBe("partial");

    await post("/payments", s.t, { saleId: sl.id, amount: 400, method: "mpesa" });
    let d = (await get(`/invoices/${inv.id}`, s.t)).body.data;
    expect(N(d.amountPaid)).toBe(1400);
    expect(N(d.balanceDue)).toBe(1000);
    expect(d.status).toBe("partial");

    await put(`/sales/${sl.id}`, s.t, { items: [{ productId: s.charger.id, quantity: 3, unitPrice: 1200 }] });
    d = (await get(`/invoices/${inv.id}`, s.t)).body.data;
    expect(N(d.total)).toBe(3600);
    expect(N(d.items[0].quantity)).toBe(3);
    expect(N(d.balanceDue)).toBe(2200);

    await post("/payments", s.t, { saleId: sl.id, amount: 2200, method: "cash" });
    expect((await get(`/invoices/${inv.id}`, s.t)).body.data.status).toBe("paid");
    const listed = (await get("/invoices", s.t)).body.data.find((x: any) => x.id === inv.id);
    expect(listed.status).toBe("paid");
    expect(N(listed.balanceDue)).toBe(0);

    await post(`/sales/${sl.id}/void`, s.t, { reason: "Cancelled order", refundMethod: "cash" });
    d = (await get(`/invoices/${inv.id}`, s.t)).body.data;
    expect(d.status).toBe("void");
    expect(N(d.balanceDue)).toBe(0);
  });

  it("an unpaid invoice past its due date is overdue; paying clears it", async () => {
    const sl = await sale(500, 1);
    const inv = (await invoice(sl.id, { invoiceDate: "2026-01-01", dueDate: "2026-01-31" })).body.data;
    expect(inv.status).toBe("overdue");
    await post("/payments", s.t, { saleId: sl.id, amount: 700, method: "cash" });
    expect((await get(`/invoices/${inv.id}`, s.t)).body.data.status).toBe("paid");
  });

  it("refuses voided sales, unknown sales and invalid input", async () => {
    const v = await sale(0, 1);
    await post(`/sales/${v.id}/void`, s.t, { reason: "x" });
    expect((await invoice(v.id)).status).toBe(409);
    expect((await invoice("999999")).status).toBe(404);
    const sl = await sale();
    for (const bad of [
      { saleId: "abc" }, { saleId: "" }, { invoiceNumber: "x".repeat(101) }, { invoiceDate: "nope" },
      { dueDate: "nope" }, { invoiceDate: "2026-06-10", dueDate: "2026-06-01" }, { notes: 5 },
    ]) {
      expect((await post("/invoices", s.t, { saleId: sl.id, ...bad })).status, JSON.stringify(bad)).toBe(400);
    }
    expect((await post("/invoices", s.t, {})).status).toBe(400);
  });

  it("tenant isolation and permissions", async () => {
    const sl = await sale();
    const inv = (await invoice(sl.id)).body.data;
    expect((await get(`/invoices/${inv.id}`, other)).status).toBe(404);
    expect((await get("/invoices", other)).body.data.map((x: any) => x.id)).not.toContain(inv.id);
    expect((await post("/invoices", other, { saleId: (await sale()).id })).status).toBe(404);
    expect((await get("/invoices/abc", s.t)).status).toBe(404);
    const csh = await addEmployee(s.t, "Cashier");
    const mgr = await addEmployee(s.t, "Manager");
    expect((await get("/invoices", csh)).status).toBe(403);
    expect((await post("/invoices", csh, { saleId: (await sale()).id })).status).toBe(403);
    expect((await get("/invoices", mgr)).status).toBe(200);
    expect((await post("/invoices", mgr, { saleId: (await sale()).id })).status).toBe(201);
  });

  it("parallel invoice creation never hands out the same number", async () => {
    const sales = await Promise.all(Array.from({ length: 6 }, () => sale()));
    const rs = await Promise.all(sales.map((x) => invoice(x.id)));
    expect(rs.every((r) => r.status === 201)).toBe(true);
    const numbers = rs.map((r) => r.body.data.invoiceNumber);
    expect(new Set(numbers).size).toBe(6);
  });
});
