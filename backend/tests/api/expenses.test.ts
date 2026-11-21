import { describe, it, expect, beforeAll } from "vitest";
import { query, resetData } from "../support/db.js";
import { del, get, post, put } from "../support/http.js";
import { addEmployee, registerTenant, seedPhoneShop, type Tenant } from "../support/seed.js";

describe("expenses", () => {
  let s: Awaited<ReturnType<typeof seedPhoneShop>>;
  let other: Tenant;
  beforeAll(async () => { await resetData(); s = await seedPhoneShop(); other = await registerTenant("Other"); });

  const mk = async (o: object = {}) =>
    (await post("/expenses", s.t, { category: "Rent", amount: 15000, paymentMethod: "M-Pesa", ...o })).body.data;

  it("records an expense exactly and normalises the payment method", async () => {
    const r = await post("/expenses", s.t, { category: " Electricity ", amount: 1234.5, paymentMethod: "M-Pesa", reference: "KPLC-1" });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ category: "Electricity", amount: "1234.50", paymentMethod: "m-pesa", reference: "KPLC-1" });
    const [a] = await query(`select action from audit_logs where entity = 'expense' and entity_id = (select id from expenses where public_id = $1)`, [r.body.data.id]);
    expect(a!.action).toBe("expense.create");
  });

  it("rejects invalid input", async () => {
    for (const bad of [
      { category: " " }, { category: "x".repeat(101) }, { amount: 0 }, { amount: -5 }, { amount: "abc" },
      { amount: 10.555 }, { amount: 1e13 }, { expenseDate: "not a date" }, { expenseDate: "1999-01-01" },
      { expenseDate: "2099-01-01" }, { description: 5 },
    ]) {
      const r = await post("/expenses", s.t, { category: "Rent", amount: 100, ...bad });
      expect(r.status, JSON.stringify(bad)).toBe(400);
    }
  });

  it("edits an expense and keeps before/after in the audit log; invalid edits change nothing", async () => {
    const e = await mk({ category: "Rent", amount: 15000 });
    expect((await put(`/expenses/${e.id}`, s.t, { amount: -1 })).status).toBe(400);
    expect((await put(`/expenses/${e.id}`, s.t, { category: "" })).status).toBe(400);
    const u = await put(`/expenses/${e.id}`, s.t, { amount: 16000, notes: "Raised" });
    expect(u.status).toBe(200);
    expect(u.body.data).toMatchObject({ category: "Rent", amount: "16000.00", notes: "Raised" });
    const [a] = await query(`select details from audit_logs where entity = 'expense' and entity_id = (select id from expenses where public_id = $1) and action = 'expense.update'`, [e.id]);
    expect(a!.details.before.amount).toBe("15000.00");
    expect(a!.details.after.amount).toBe("16000.00");
  });

  it("deleting needs a reason and leaves a snapshot behind", async () => {
    const e = await mk({ category: "Mistake", amount: 777 });
    const [{ id: internalId }] = await query<{ id: string }>(`select id from expenses where public_id = $1`, [e.id]);
    expect((await del(`/expenses/${e.id}`, s.t, {})).status).toBe(400);
    expect((await del(`/expenses/${e.id}`, s.t, { reason: "Entered twice" })).status).toBe(200);
    expect((await get(`/expenses/${e.id}`, s.t)).status).toBe(404);
    expect((await get("/expenses", s.t)).body.data.map((x: any) => x.id)).not.toContain(e.id);
    const [a] = await query(`select details from audit_logs where entity = 'expense' and entity_id = $1 and action = 'expense.delete'`, [internalId]);
    expect(a!.details.reason).toBe("Entered twice");
    expect(a!.details.snapshot.amount).toBe("777.00");
  });

  it("edits and deletions flow into reports", async () => {
    const t = await seedPhoneShop();
    const e = (await post("/expenses", t.t, { category: "Rent", amount: 1000 })).body.data;
    const url = "/reports?startDate=2026-01-01&endDate=2026-12-31";
    expect((await get(url, t.t)).body.data.summary.totalExpenses).toBe(1000);
    await put(`/expenses/${e.id}`, t.t, { amount: 1500 });
    expect((await get(url, t.t)).body.data.summary.totalExpenses).toBe(1500);
    await del(`/expenses/${e.id}`, t.t, { reason: "gone" });
    expect((await get(url, t.t)).body.data.summary.totalExpenses).toBe(0);
  });

  it("tenant isolation, bad ids and permissions", async () => {
    const e = await mk();
    expect((await get(`/expenses/${e.id}`, other)).status).toBe(404);
    expect((await put(`/expenses/${e.id}`, other, { amount: 1 })).status).toBe(404);
    expect((await del(`/expenses/${e.id}`, other, { reason: "x" })).status).toBe(404);
    expect((await get("/expenses", other)).body.data.map((x: any) => x.id)).not.toContain(e.id);
    expect((await get("/expenses/abc", s.t)).status).toBe(400);
    expect((await get("/expenses/1", s.t)).status).toBe(400); // a sequential id is refused
    expect((await get("/expenses/3f2b1c1e-9d4a-4c55-8a1e-0b9f6d7e1a42", s.t)).status).toBe(404); // a random UUID that isn't ours
    const csh = await addEmployee(s.t, "Cashier");
    const acct = await addEmployee(s.t, "Accountant");
    expect((await get("/expenses", csh)).status).toBe(403);
    expect((await post("/expenses", csh, { category: "x", amount: 1 })).status).toBe(403);
    expect((await get("/expenses", acct)).status).toBe(200);
    expect((await put(`/expenses/${e.id}`, csh, { amount: 1 })).status).toBe(403);
    expect((await del(`/expenses/${e.id}`, csh, { reason: "x" })).status).toBe(403);
    // accountants manage expenses by default
    expect((await put(`/expenses/${e.id}`, acct, { notes: "checked" })).status).toBe(200);
  });
});
