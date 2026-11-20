import { describe, it, expect, beforeAll } from "vitest";
import { query, resetData } from "../support/db.js";
import { api, get, post } from "../support/http.js";
import { addEmployee, createCustomer, createProduct, ledgerViolations, mpesaCode, registerTenant } from "../support/seed.js";

const line = (productId: string, quantity: number, unitPrice = 100) => ({ productId, quantity, unitPrice });
const RANGE = "startDate=2020-01-01&endDate=2030-12-31";

describe("a customer pays off their debt", () => {
  let owner: Awaited<ReturnType<typeof registerTenant>>;
  let product: { id: string };
  let customer: { id: string };
  const credit = async (qty: number, paid: number, who = owner, cust = customer) => {
    const r = await post("/sales", who, { customerId: cust.id, items: [line(product.id, qty)], paymentMethod: "cash", amountPaid: paid });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body.data as { id: string; receiptNumber: string };
  };
  const owed = async (c = customer) => Number((await get("/customers", owner)).body.data.find((x: any) => x.id === c.id).balance);
  const pay = (body: unknown, c = customer, key?: string) =>
    api("POST", `/customers/${c.id}/payments`, { session: owner, body, ...(key && { headers: { "idempotency-key": key } }) });
  let a: any, b: any, d: any;

  beforeAll(async () => {
    await resetData();
    owner = await registerTenant("Debt Shop");
    product = await createProduct(owner, { name: "Soda", costPrice: 40, sellingPrice: 100, stockQuantity: 1000 });
    customer = await createCustomer(owner, "Mama Njeri");
    a = await credit(3, 0);   // owes 300 (oldest)
    b = await credit(2, 0);   // owes 200
    d = await credit(5, 100); // owes 400
  }, 60_000);

  it("lists what the customer owes, oldest first", async () => {
    const r = (await get(`/customers/${customer.id}/unpaid-sales`, owner)).body.data;
    expect(r.totalOwed).toBe("900.00");
    expect(r.sales.map((s: any) => [s.receiptNumber, s.balanceDue])).toEqual([[a.receiptNumber, "300.00"], [b.receiptNumber, "200.00"], [d.receiptNumber, "400.00"]]);
    expect(await owed()).toBe(900);
  });

  it("spreads a payment over the oldest sales first and updates sales and the customer together", async () => {
    expect((await pay({ amount: 0, method: "cash" })).status).toBe(400);
    expect((await pay({ amount: 100 })).status).toBe(400); // no method
    expect((await pay({ amount: 900.01, method: "cash" })).status).toBe(400); // more than owed

    const r = await pay({ amount: 350, method: "cash" });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data.allocations.map((x: any) => [x.receiptNumber, x.paid, x.balanceAfter, x.status])).toEqual([
      [a.receiptNumber, "300.00", "0.00", "paid"], [b.receiptNumber, "50.00", "150.00", "partial"],
    ]);
    expect(r.body.data.customer.balance).toBe("550.00");
    expect(await owed()).toBe(550);
    const sales = (await get("/sales", owner)).body.data;
    const saleA = sales.find((s: any) => s.id === a.id), saleD = sales.find((s: any) => s.id === d.id);
    expect([saleA.paymentStatus, Number(saleA.balanceDue)]).toEqual(["paid", 0]);
    expect([saleD.paymentStatus, Number(saleD.balanceDue)]).toEqual(["partial", 400]);
    expect(await query(`select count(*)::int as n from payments where created_by is not null and notes like 'Account payment%'`)).toEqual([{ n: 2 }]);
  });

  it("stores an M-Pesa code once, refuses a reused or invalid code, and finishes the debt", async () => {
    expect((await pay({ amount: 300, method: "mpesa", reference: "bad" })).status).toBe(400);
    const code = mpesaCode();
    const r = await pay({ amount: 300, method: "mpesa", reference: code });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data.allocations.map((x: any) => x.paid)).toEqual(["150.00", "150.00"]);
    const refs = await query(`select reference from payments where method = 'mpesa' order by id`);
    expect(refs.map((x: any) => x.reference)).toEqual([code, null]); // code on the first part only; the second points to it
    expect((await pay({ amount: 50, method: "mpesa", reference: code })).status).toBe(409);

    expect(await owed()).toBe(250);
    expect((await pay({ amount: 250, method: "cash" })).status).toBe(201);
    expect(await owed()).toBe(0);
    expect((await get(`/customers/${customer.id}/unpaid-sales`, owner)).body.data.sales).toEqual([]);
    expect((await get("/sales", owner)).body.data.filter((s: any) => s.customerId === customer.id).every((s: any) => s.paymentStatus === "paid")).toBe(true);
    expect((await pay({ amount: 10, method: "cash" })).status).toBe(409); // nothing left to pay
    expect(await ledgerViolations()).toEqual([]);
  });

  it("takes the money once when the same request is sent twice", async () => {
    const c = await createCustomer(owner, "Double Click");
    await credit(4, 0, owner, c);
    const first = await pay({ amount: 100, method: "cash" }, c, "retry-key-1");
    const second = await pay({ amount: 100, method: "cash" }, c, "retry-key-1");
    expect([first.status, second.status]).toEqual([201, 201]);
    expect(second.body.data.idempotentReplay).toBe(true);
    expect(await owed(c)).toBe(300);
    expect(await query(`select count(*)::int as n from payments p join sales s on s.id = p.sale_id where s.customer_id = (select id from customers where public_id = $1::uuid)`, [c.id])).toEqual([{ n: 1 }]);
  });

  it("is safe with simultaneous payments: never takes more than is owed", async () => {
    const c = await createCustomer(owner, "Busy Payer");
    await credit(3, 0, owner, c); // owes 300
    const results = await Promise.all(Array.from({ length: 6 }, () => pay({ amount: 100, method: "cash" }, c)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(3);
    expect(results.filter((r) => r.status !== 201).every((r) => [400, 409].includes(r.status))).toBe(true);
    expect(await owed(c)).toBe(0);
    expect(await ledgerViolations()).toEqual([]);
  });

  it("lets a till operator settle only the sales they made themselves", async () => {
    const cashier = await addEmployee(owner, "settle-cashier", ["products.view", "customers.view", "sales.create", "sales.view_own", "payments.create"]);
    const c = await createCustomer(owner, "Shared Customer");
    await credit(2, 0, owner, c);    // owner's sale, owes 200
    await credit(1, 0, cashier, c);  // cashier's sale, owes 100
    const seen = (await api("GET", `/customers/${c.id}/unpaid-sales`, { session: cashier })).body.data;
    expect(seen.totalOwed).toBe("100.00");
    expect((await api("POST", `/customers/${c.id}/payments`, { session: cashier, body: { amount: 150, method: "cash" } })).status).toBe(400);
    expect((await api("POST", `/customers/${c.id}/payments`, { session: cashier, body: { amount: 100, method: "cash" } })).status).toBe(201);
    expect(await owed(c)).toBe(200); // the owner's part is untouched
    const noPay = await addEmployee(owner, "viewer-only", ["customers.view"]);
    expect((await api("POST", `/customers/${c.id}/payments`, { session: noPay, body: { amount: 10, method: "cash" } })).status).toBe(403);
  });
});

describe("how a sale was made", () => {
  it("records walk-in by default, accepts the other types, refuses unknown ones, and reports them", async () => {
    await resetData();
    const t = await registerTenant("Channel Shop");
    const p = await createProduct(t, { name: "Item", costPrice: 40, sellingPrice: 100, stockQuantity: 100 });
    const sell = (extra: object) => post("/sales", t, { items: [line(p.id, 1)], paymentMethod: "cash", amountPaid: 100, ...extra });
    expect((await sell({})).body.data.channel).toBe("walk_in");
    expect((await sell({ channel: "online" })).body.data.channel).toBe("online");
    expect((await sell({ channel: "online" })).status).toBe(201);
    expect((await sell({ channel: "phone" })).body.data.channel).toBe("phone");
    expect((await sell({ channel: "delivery" })).status).toBe(201);
    expect((await sell({ channel: "other", notes: "Church fundraiser" })).body.data.channel).toBe("other");
    expect((await sell({ channel: "teleport" })).status).toBe(400);

    const r = (await get(`/reports?${RANGE}`, t)).body.data.salesByChannel;
    expect(Object.fromEntries(r.map((x: any) => [x.channel, x.salesCount]))).toEqual({ walk_in: 1, online: 2, phone: 1, delivery: 1, other: 1 });
    expect((await get("/sales", t)).body.data.every((s: any) => typeof s.channel === "string")).toBe(true);
    await expect(query(`update sales set channel = 'bogus'`)).rejects.toThrow(/sales_channel_valid/);
  });
});

describe("debt on the reports", () => {
  it("shows what is owed per customer, its age, new debt and what was collected", async () => {
    const t = await registerTenant("Debt Report Shop");
    const p = await createProduct(t, { name: "Item", costPrice: 40, sellingPrice: 100, stockQuantity: 100 });
    const c = await createCustomer(t, "Mama Debt");
    const sale = await post("/sales", t, { items: [line(p.id, 5)], customerId: c.id, paymentMethod: "cash", amountPaid: 100 });
    expect(sale.status).toBe(201); // owes 400
    await query(`update sales set sale_date = now() - interval '45 days' where id = ${sale.body.data.id}`);
    await query(`update payments set payment_date = now() - interval '45 days' where sale_id = ${sale.body.data.id}`);
    await post("/sales", t, { items: [line(p.id, 1)], customerId: c.id, paymentMethod: "cash", amountPaid: 0 }); // owes 100 today

    const wide = "startDate=2020-01-01&endDate=2030-01-01";
    let d = (await get(`/reports?${wide}`, t)).body.data.debts;
    expect(d.totalOutstanding).toBe(500);
    expect(d.customers).toHaveLength(1);
    expect(d.customers[0]).toMatchObject({ customerName: "Mama Debt", owed: 500, unpaidSales: 2 });
    expect(d.aging).toEqual({ days0to30: 100, days31to60: 400, days61plus: 0 });
    expect(d.newDebtInPeriod).toBe(500);

    const pay = await post(`/customers/${c.id}/payments`, t, { amount: 250, method: "cash" });
    expect(pay.status).toBe(201);
    d = (await get(`/reports?${wide}`, t)).body.data.debts;
    expect(d.totalOutstanding).toBe(250);
    expect(d.collectedInPeriod).toBe(250);
  });
});

