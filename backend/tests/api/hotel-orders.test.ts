import { describe, it, expect, beforeAll } from "vitest";
import { query, resetData } from "../support/db.js";
import { del, get, post, put } from "../support/http.js";
import { addEmployee, registerTenant, type Tenant } from "../support/seed.js";

describe("hotel: made-to-order meals, tables, open orders and billing", () => {
  let owner: Tenant, other: Tenant, waiter: Tenant, viewer: Tenant;
  let n = 0;
  const meal = async (name: string, price: number, extra: Record<string, unknown> = {}) => {
    const r = await post("/products", owner, { name, costPrice: 0, sellingPrice: price, tracksStock: false, ...extra });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body.data.id as string;
  };
  const table = async (name = `T${++n}`) => (await post("/hotel/tables", owner, { name, seats: 4 })).body.data.id as string;
  const open = async (tableId: string) => (await post(`/hotel/tables/${tableId}/orders`, owner, { guestName: "Mr Kamau", covers: 2 })).body.data.id as string;
  const stockOf = async (productId: string) => Number((await query<{ q: string }>(`select coalesce(sum(bs.quantity),0)::text q from branch_stock bs join products p on p.id = bs.product_id where p.public_id = $1::uuid`, [productId]))[0]!.q);

  beforeAll(async () => {
    await resetData();
    owner = await registerTenant("Safari Lodge", "hotel");
    other = await registerTenant("Other Lodge", "hotel");
    waiter = await addEmployee(owner, "Cashier");
    viewer = await addEmployee(owner, "Viewer");
  }, 60_000);

  it("a made-to-order meal sells with no stock, and stock is never touched", async () => {
    const pilau = await meal("Pilau", 450);
    const t = await table(); const o = await open(t);
    expect((await post(`/hotel/orders/${o}/items`, owner, { productId: pilau, quantity: 3 })).status).toBe(201);
    const bill = await post(`/hotel/orders/${o}/bill`, owner, {});
    expect(bill.status, JSON.stringify(bill.body)).toBe(200);
    expect(Number(bill.body.data.sale.total)).toBe(1350);
    expect(bill.body.data.order.status).toBe("billed");
    expect(await stockOf(pilau)).toBe(0);
    const mv = await query<{ c: string }>(`select count(*) c from inventory_movements where product_id = (select id from products where public_id = $1::uuid)`, [pilau]);
    expect(Number(mv[0]!.c)).toBe(0);
  });

  it("a normal stocked product still needs stock, and tracked items still deduct", async () => {
    const soda = (await post("/products", owner, { name: "Soda", costPrice: 20, sellingPrice: 80, stockQuantity: 5 })).body.data.id;
    const t = await table(); const o = await open(t);
    await post(`/hotel/orders/${o}/items`, owner, { productId: soda, quantity: 2 });
    expect((await post(`/hotel/orders/${o}/bill`, owner, {})).status).toBe(200);
    expect(await stockOf(soda)).toBe(3);
    const t2 = await table(); const o2 = await open(t2);
    await post(`/hotel/orders/${o2}/items`, owner, { productId: soda, quantity: 9 });
    const refused = await post(`/hotel/orders/${o2}/bill`, owner, {});
    expect(refused.status).toBe(400);
    expect(refused.body.message).toMatch(/Insufficient stock/);
    expect((await get(`/hotel/orders/${o2}`, owner)).body.data.status).toBe("open"); // nothing was lost
  });

  it("voiding a billed meal does not put imaginary stock back", async () => {
    const dish = await meal("Nyama Choma", 900);
    const o = await open(await table());
    await post(`/hotel/orders/${o}/items`, owner, { productId: dish, quantity: 2 });
    const sale = (await post(`/hotel/orders/${o}/bill`, owner, {})).body.data.sale;
    const v = await post(`/sales/${sale.id}/void`, owner, { refundMethod: "cash", reason: "Guest walked out" });
    expect(v.status, JSON.stringify(v.body)).toBe(200);
    expect(await stockOf(dish)).toBe(0);
  });

  it("a table has one open order at a time", async () => {
    const t = await table(); await open(t);
    expect((await post(`/hotel/tables/${t}/orders`, owner, {})).status).toBe(409);
  });

  it("sold-out items cannot be added, and the price on a line is frozen when it is added", async () => {
    const tea = await meal("Chai", 100);
    const o = await open(await table());
    await post(`/hotel/orders/${o}/items`, owner, { productId: tea, quantity: 1 });
    expect((await put(`/products/${tea}`, owner, { sellingPrice: 150 })).status).toBe(200);
    const after = (await get(`/hotel/orders/${o}`, owner)).body.data;
    expect(after.items[0].unitPrice).toBe("100");
    await put(`/products/${tea}`, owner, { isAvailable: false });
    const r = await post(`/hotel/orders/${o}/items`, owner, { productId: tea, quantity: 1 });
    expect(r.status).toBe(409); expect(r.body.message).toMatch(/sold out/);
    expect((await get("/hotel/menu", owner)).body.data.find((m: any) => m.id === tea).available).toBe(false);
  });

  it("unsent items are simply removed; sent items need a reason and stay on the record but not on the bill", async () => {
    const a = await meal("Ugali", 120), b = await meal("Sukuma", 80);
    const o = await open(await table());
    const first = (await post(`/hotel/orders/${o}/items`, owner, { productId: a, quantity: 1 })).body.data.items[0].id;
    expect((await del(`/hotel/orders/${o}/items/${first}`, owner)).body.data.items).toHaveLength(0);
    await post(`/hotel/orders/${o}/items`, owner, { productId: a, quantity: 1 });
    await post(`/hotel/orders/${o}/items`, owner, { productId: b, quantity: 2, note: "no onions" });
    const sent = await post(`/hotel/orders/${o}/send`, owner, {});
    expect(sent.body.data.sent.map((s: any) => s.name).sort()).toEqual(["Sukuma", "Ugali"]);
    expect((await post(`/hotel/orders/${o}/send`, owner, {})).status).toBe(409);
    const id = sent.body.data.order.items.find((i: any) => i.name === "Sukuma").id;
    expect((await del(`/hotel/orders/${o}/items/${id}`, owner, {})).status).toBe(400);
    const gone = await del(`/hotel/orders/${o}/items/${id}`, owner, { reason: "Guest changed mind" });
    expect(gone.status).toBe(200);
    expect(gone.body.data.runningTotal).toBe("120.00");
    const bill = await post(`/hotel/orders/${o}/bill`, owner, {});
    expect(Number(bill.body.data.sale.total)).toBe(120);
  });

  it("billing twice makes one sale, and the second answer is the same receipt", async () => {
    const d = await meal("Githeri", 200);
    const o = await open(await table());
    await post(`/hotel/orders/${o}/items`, owner, { productId: d, quantity: 1 });
    const a = await post(`/hotel/orders/${o}/bill`, owner, {});
    const b = await post(`/hotel/orders/${o}/bill`, owner, {});
    expect(b.status).toBe(200);
    expect(b.body.data.sale.receiptNumber).toBe(a.body.data.sale.receiptNumber);
    expect(b.body.data.alreadyBilled).toBe(true);
    const c = await query<{ c: string }>(`select count(*) c from sales where notes like 'T%' and receipt_number = $1`, [a.body.data.sale.receiptNumber]);
    expect(Number(c[0]!.c)).toBe(1);
    expect((await post(`/hotel/orders/${o}/items`, owner, { productId: d, quantity: 1 })).status).toBe(409); // billed: closed
  });

  it("pay part by M-PESA code, leave the rest unpaid needs a customer; empty orders cannot be billed", async () => {
    const o = await open(await table());
    expect((await post(`/hotel/orders/${o}/bill`, owner, {})).status).toBe(400);
    const d = await meal("Mandazi", 50);
    await post(`/hotel/orders/${o}/items`, owner, { productId: d, quantity: 4 });
    const part = await post(`/hotel/orders/${o}/bill`, owner, { amountPaid: 100, paymentMethod: "cash" });
    expect(part.status).toBe(400); // balance needs a customer, same rule as the till
  });

  it("cancelling frees the table; a sent order needs a reason", async () => {
    const t = await table(); const o = await open(t);
    const d = await meal("Eggs", 90);
    await post(`/hotel/orders/${o}/items`, owner, { productId: d, quantity: 1 });
    await post(`/hotel/orders/${o}/send`, owner, {});
    expect((await post(`/hotel/orders/${o}/cancel`, owner, {})).status).toBe(400);
    expect((await post(`/hotel/orders/${o}/cancel`, owner, { reason: "Guests left" })).status).toBe(200);
    expect((await post(`/hotel/tables/${t}/orders`, owner, {})).status).toBe(201);
  });

  it("changing stock tracking is blocked once an item has been sold; stock adjustments are refused for meals", async () => {
    const d = await meal("Fish", 700);
    const o = await open(await table());
    await post(`/hotel/orders/${o}/items`, owner, { productId: d, quantity: 1 });
    await post(`/hotel/orders/${o}/bill`, owner, {});
    expect((await put(`/products/${d}`, owner, { tracksStock: true })).status).toBe(409);
    const adj = await post("/inventory", owner, { productId: d, type: "IN", quantity: 5 });
    expect(adj.status).toBe(400);
  });

  it("permissions and isolation: staff take orders, only managers add tables, other businesses see nothing", async () => {
    expect((await post("/hotel/tables", waiter, { name: "Nope" })).status).toBe(403);
    expect((await get("/hotel/tables", waiter)).status).toBe(200);
    expect((await get("/hotel/tables", viewer)).status).toBe(403);
    const t = await table(); const o = await open(t);
    expect((await get(`/hotel/orders/${o}`, other)).status).toBe(404);
    expect((await post(`/hotel/tables/${t}/orders`, other, {})).status).toBe(404);
    expect((await get("/hotel/tables", other)).body.data).toEqual([]);
    expect((await post("/hotel/tables", owner, { name: "dup", seats: 0 })).status).toBe(400);
    await post("/hotel/tables", owner, { name: "Same" });
    expect((await post("/hotel/tables", owner, { name: "Same" })).status).toBe(409);
  });

  it("a table with an open order cannot be removed; a free one can", async () => {
    const t = await table(); await open(t);
    expect((await del(`/hotel/tables/${t}`, owner)).status).toBe(409);
    const free = await table();
    expect((await del(`/hotel/tables/${free}`, owner)).status).toBe(200);
    expect((await get("/hotel/tables", owner)).body.data.find((x: any) => x.id === free)).toBeUndefined();
  });

  it("database rules: billed orders need a sale, quantities positive, one open order per table", async () => {
    await expect(query(`update table_orders set status='billed', closed_at=now(), sale_id=null where status='open' and id=(select min(id) from table_orders where status='open')`)).rejects.toThrow(/billed_has_sale/);
    await expect(query(`update table_order_items set quantity = 0 where id = (select min(id) from table_order_items)`)).rejects.toThrow(/qty_positive/);
    await expect(query(`insert into table_orders(business_id,branch_id,table_id,opened_by) select business_id,branch_id,table_id,opened_by from table_orders where status='open' limit 1`)).rejects.toThrow(/one_open_per_table/);
  });
});
