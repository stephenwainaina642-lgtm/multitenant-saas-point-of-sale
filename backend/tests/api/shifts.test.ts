import { describe, it, expect, beforeAll } from "vitest";
import { query, resetData } from "../support/db.js";
import { get, post } from "../support/http.js";
import { addEmployee, createCustomer, createProduct, mpesaCode, registerTenant } from "../support/seed.js";

const line = (productId: string, quantity: number, unitPrice = 100) => ({ productId, quantity, unitPrice });

describe("till shifts and end-of-day cash-up", () => {
  let owner: Awaited<ReturnType<typeof registerTenant>>;
  let cashier: typeof owner, manager: typeof owner, nobody: typeof owner;
  let product: { id: string };

  beforeAll(async () => {
    await resetData();
    owner = await registerTenant("Shift Shop");
    const cashPerms = ["products.view", "customers.view", "sales.create", "sales.view_own", "sales.void", "payments.create", "shifts.use"];
    cashier = await addEmployee(owner, "till-cashier", cashPerms);
    manager = await addEmployee(owner, "till-manager", ["shifts.use", "shifts.view_all"]);
    nobody = await addEmployee(owner, "no-shift-access", ["products.view"]);
    product = await createProduct(owner, { name: "Soda", costPrice: 40, sellingPrice: 100, stockQuantity: 1000 });
  }, 60_000);

  it("computes expected cash from recorded takings, only this cashier's, and locks the record on close", async () => {
    expect((await post("/shifts/open", cashier, { openingFloat: -5 })).status).toBe(400);
    const open = await post("/shifts/open", cashier, { openingFloat: 1000 });
    expect(open.status, JSON.stringify(open.body)).toBe(201);
    const id = open.body.data.id;
    expect((await post("/shifts/open", cashier, { openingFloat: 1 })).status).toBe(409); // one open shift per cashier

    await post("/sales", owner, { items: [line(product.id, 3)], paymentMethod: "cash", amountPaid: 300 });   // the owner's cash: not this drawer
    await post("/sales", cashier, { items: [line(product.id, 5)], paymentMethod: "cash", amountPaid: 500 });
    const mp = await post("/sales", cashier, { items: [line(product.id, 2)], paymentMethod: "mpesa", amountPaid: 200, paymentReference: mpesaCode() });
    const customer = await createCustomer(owner, "Credit Customer");
    const credit = await post("/sales", cashier, { items: [line(product.id, 4)], paymentMethod: "cash", amountPaid: 100, customerId: customer.id });
    expect(credit.status, JSON.stringify(credit.body)).toBe(201);
    const later = await post("/payments", cashier, { saleId: credit.body.data.id, amount: 300, method: "cash" });
    expect(later.status, JSON.stringify(later.body)).toBe(201);
    const small = await post("/sales", cashier, { items: [line(product.id, 1)], paymentMethod: "cash", amountPaid: 100 });
    expect((await post(`/sales/${small.body.data.id}/void`, cashier, { reason: "Customer changed mind", refundMethod: "cash" })).status).toBe(200);
    expect((await post(`/sales/${mp.body.data.id}/void`, cashier, { reason: "Wrong order", refundMethod: "mpesa", refundReference: mpesaCode() })).status).toBe(200);

    // cash in 500 + 100 + 300 + 100 = 1000; cash refunded 100 (the M-Pesa refund is not cash); expected 1000 + 1000 - 100 = 1900
    const live = (await get("/shifts/current", cashier)).body.data;
    expect(live.live).toMatchObject({ cashReceived: "1000.00", cashRefunded: "100.00", expectedCash: "1900.00" });
    expect(live.live.totalsByMethod).toMatchObject({ cash: "1000.00", mpesa: "200.00" });
  });

  it("needs a note when the count is off, records the difference, and freezes the shift", async () => {
    const id = (await get("/shifts/current", cashier)).body.data.id;
    expect((await post(`/shifts/${id}/close`, cashier, { countedCash: -1 })).status).toBe(400);
    expect((await post(`/shifts/${id}/close`, cashier, {})).status).toBe(400);
    const noNote = await post(`/shifts/${id}/close`, cashier, { countedCash: 1850 });
    expect(noNote.status).toBe(400);
    expect(noNote.body.message).toMatch(/note/i);

    const closed = await post(`/shifts/${id}/close`, cashier, { countedCash: 1850, note: "Gave change out of pocket" });
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);
    expect(closed.body.data).toMatchObject({ status: "closed", openingFloat: "1000.00", expectedCash: "1900.00", countedCash: "1850.00", variance: "-50.00", closeNote: "Gave change out of pocket" });
    expect((await post(`/shifts/${id}/close`, cashier, { countedCash: 1900 })).status).toBe(409); // cannot close twice

    // later sales never change a closed shift, and the database itself refuses edits and deletes
    await post("/sales", cashier, { items: [line(product.id, 1)], paymentMethod: "cash", amountPaid: 100 });
    expect((await get(`/shifts/${id}`, cashier)).body.data.expectedCash).toBe("1900.00");
    await expect(query(`update register_shifts set counted_cash = 1900, variance = 0 where public_id = $1::uuid`, [id])).rejects.toThrow(/closed shift cannot be changed/);
    await expect(query(`delete from register_shifts where public_id = $1::uuid`, [id])).rejects.toThrow(/cannot be deleted/);

    // a manager can add a note; the cashier cannot
    expect((await post(`/shifts/${id}/note`, cashier, { note: "x" })).status).toBe(403);
    const noted = await post(`/shifts/${id}/note`, manager, { note: "Checked with cashier, OK" });
    expect(noted.status).toBe(200);
    expect(noted.body.data).toMatchObject({ managerNote: "Checked with cashier, OK", variance: "-50.00" });

    // a new shift can be opened afterwards, and it starts counting from zero
    const next = await post("/shifts/open", cashier, { openingFloat: 500 });
    expect(next.status).toBe(201);
    expect(next.body.data.live.expectedCash).toBe("500.00");
    expect((await post(`/shifts/${next.body.data.id}/close`, cashier, { countedCash: 500 })).status).toBe(200); // exact count needs no note
  });

  it("limits who can see and close which shifts", async () => {
    const mine = await post("/shifts/open", manager, { openingFloat: 200 });
    const cashiers = (await get("/shifts", cashier)).body.data;
    expect(cashiers.every((s: any) => s.openedByName !== null && s.id !== mine.body.data.id)).toBe(true); // cashier sees only their own
    const all = (await get("/shifts", manager)).body.data;
    expect(all.length).toBeGreaterThan(cashiers.length);
    expect((await get(`/shifts/${mine.body.data.id}`, cashier)).status).toBe(404);
    expect((await post(`/shifts/${mine.body.data.id}/close`, cashier, { countedCash: 200 })).status).toBe(403);
    expect((await get("/shifts/current", nobody)).status).toBe(403);
    expect((await post("/shifts/open", nobody, { openingFloat: 0 })).status).toBe(403);
    // a manager may close someone else's open shift (e.g. cashier went home)
    const cOpen = await post("/shifts/open", cashier, { openingFloat: 0 });
    expect((await post(`/shifts/${cOpen.body.data.id}/close`, manager, { countedCash: 0 })).status).toBe(200);
    expect((await post(`/shifts/${mine.body.data.id}/close`, manager, { countedCash: 200 })).status).toBe(200);
  });

  it("cannot open two shifts at once even with simultaneous requests", async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => post("/shifts/open", cashier, { openingFloat: 10 })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(5);
  });
});
