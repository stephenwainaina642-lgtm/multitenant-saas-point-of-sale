import { describe, it, expect, beforeAll } from "vitest";
import { query, resetData } from "../support/db.js";
import { api, get, post } from "../support/http.js";
import { createCustomer, createProduct, ledgerViolations, registerTenant, stockOf } from "../support/seed.js";

const line = (productId: string, quantity: number, unitPrice: number) => ({ productId, quantity, unitPrice });

describe("M-Pesa transaction codes", () => {
  beforeAll(resetData);

  async function shop(name = "Mpesa Shop") {
    const t = await registerTenant(name);
    const p = await createProduct(t, { name: "Item", costPrice: 10, sellingPrice: 100, stockQuantity: 100 });
    const c = await createCustomer(t, "Credit Customer");
    return { t, p, c };
  }

  it("needs a well-formed code for an M-Pesa payment and stores it in capitals", async () => {
    const { t, p } = await shop();
    const base = { amountPaid: 100, paymentMethod: "mpesa", items: [line(p.id, 1, 100)] };
    expect((await post("/sales", t, base)).status).toBe(400);                                  // missing
    for (const bad of ["", "ABC", "QGH7XK2LM!", "QGH7XK2LMNN", "QGH7 XK2L"]) {
      const r = await post("/sales", t, { ...base, paymentReference: bad });
      expect(r.status, bad).toBe(400);
    }
    expect(await stockOf(p.id)).toBe(100);                                                      // nothing was sold
    const ok = await post("/sales", t, { ...base, paymentReference: " qgh7xk2lmn " });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const [row] = await query(`select reference, method from payments where business_id=$1`, [t.businessId]);
    expect(row).toMatchObject({ reference: "QGH7XK2LMN", method: "mpesa" });
  });

  it("refuses to reuse a code, whatever its capitalisation, and says which sale used it", async () => {
    const { t, p, c } = await shop();
    const first = await post("/sales", t, { amountPaid: 100, paymentMethod: "mpesa", paymentReference: "AB12CD34EF", items: [line(p.id, 1, 100)] });
    expect(first.status).toBe(201);
    const again = await post("/sales", t, { amountPaid: 100, paymentMethod: "mpesa", paymentReference: "ab12cd34ef", items: [line(p.id, 1, 100)] });
    expect(again.status).toBe(409);
    expect(again.body.message).toContain(first.body.data.receiptNumber);
    expect(await stockOf(p.id)).toBe(99);                                                       // the refused sale changed nothing
    expect((await get("/sales", t)).body.data).toHaveLength(1);

    // the same code cannot settle a credit sale's balance either
    const credit = await post("/sales", t, { customerId: c.id, items: [line(p.id, 1, 100)] });
    const pay = await post("/payments", t, { saleId: credit.body.data.id, amount: 100, method: "mpesa", reference: "AB12CD34EF" });
    expect(pay.status).toBe(409);
    const fresh = await post("/payments", t, { saleId: credit.body.data.id, amount: 100, method: "mpesa", reference: "ZZ99YY88XX" });
    expect(fresh.status, JSON.stringify(fresh.body)).toBe(201);
    expect(await ledgerViolations()).toEqual([]);
  });

  it("is per business, and does not touch other payment methods", async () => {
    const a = await shop("Shop A");
    const b = await shop("Shop B");
    for (const x of [a, b]) {
      const r = await post("/sales", x.t, { amountPaid: 100, paymentMethod: "mpesa", paymentReference: "SAME123456", items: [line(x.p.id, 1, 100)] });
      expect(r.status).toBe(201);
    }
    // cash and card may carry any short reference, or none, and repeat it
    for (let i = 0; i < 2; i++) {
      expect((await post("/sales", a.t, { amountPaid: 100, paymentMethod: "cash", items: [line(a.p.id, 1, 100)] })).status).toBe(201);
      expect((await post("/sales", a.t, { amountPaid: 100, paymentMethod: "card", paymentReference: "SLIP-1", items: [line(a.p.id, 1, 100)] })).status).toBe(201);
    }
  });

  it("a voided sale's code stays used, and a replayed submission is not mistaken for reuse", async () => {
    const { t, p } = await shop();
    const key = { "idempotency-key": "mp-replay-0001" };
    const body = { amountPaid: 100, paymentMethod: "mpesa", paymentReference: "RE12PL34AY", items: [line(p.id, 1, 100)] };
    const r1 = await api("POST", "/sales", { session: t, body, headers: key });
    const r2 = await api("POST", "/sales", { session: t, body, headers: key });
    expect([r1.status, r2.status]).toEqual([201, 201]);
    expect(r2.body.data.idempotentReplay).toBe(true);
    expect((await query(`select count(*)::int n from payments where business_id=$1`, [t.businessId]))[0]!.n).toBe(1);

    await post(`/sales/${r1.body.data.id}/void`, t, { reason: "Mistake", refundMethod: "cash" });
    const reuse = await post("/sales", t, { ...body, items: [line(p.id, 1, 100)] });
    expect(reuse.status).toBe(409);
  });

  it("two requests racing with the same new code: exactly one is recorded", async () => {
    const { t, p } = await shop();
    const results = await Promise.all(
      Array.from({ length: 6 }, () => post("/sales", t, { amountPaid: 100, paymentMethod: "mpesa", paymentReference: "RACE000001", items: [line(p.id, 1, 100)] }))
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(5);
    expect(results.some((r) => r.status >= 500)).toBe(false);
    expect((await query(`select count(*)::int n from payments where business_id=$1 and method='mpesa'`, [t.businessId]))[0]!.n).toBe(1);
    expect(await stockOf(p.id)).toBe(99);
  });

  it("applies when a quotation is converted to a sale", async () => {
    const { t, p } = await shop();
    const q = (await post("/quotations", t, { items: [line(p.id, 1, 100)] })).body.data;
    await post(`/quotations/${q.id}/status`, t, { status: "accepted" });
    expect((await post(`/quotations/${q.id}/convert`, t, { amountPaid: 100, paymentMethod: "mpesa" })).status).toBe(400);
    const ok = await post(`/quotations/${q.id}/convert`, t, { amountPaid: 100, paymentMethod: "mpesa", paymentReference: "QU12OT34ED" });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
  });
});
