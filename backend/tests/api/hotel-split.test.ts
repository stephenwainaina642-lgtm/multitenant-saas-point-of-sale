import { describe, it, expect, beforeAll } from "vitest";
import { query, resetData } from "../support/db.js";
import { get, post, put, del } from "../support/http.js";
import { registerTenant, type Tenant } from "../support/seed.js";

describe("hotel: split bill (bill a table in parts)", () => {
  let owner: Tenant, other: Tenant;
  let n = 0;
  const meal = async (name: string, price: number) => (await post("/products", owner, { name, costPrice: 0, sellingPrice: price, tracksStock: false })).body.data.id as string;
  const order = async (lines: [string, number][]) => {
    const tb = (await post("/hotel/tables", owner, { name: `S${++n}` })).body.data.id;
    const o = (await post(`/hotel/tables/${tb}/orders`, owner, {})).body.data.id as string;
    let last: any;
    for (const [p, q] of lines) last = await post(`/hotel/orders/${o}/items`, owner, { productId: p, quantity: q });
    return { o, items: last.body.data.items as any[] };
  };
  const saleTotal = async (id: string) => Number((await query<{ t: string }>(`select total::text t from sales where public_id = $1::uuid`, [id]))[0]!.t);

  beforeAll(async () => {
    await resetData();
    owner = await registerTenant("Split Lodge", "hotel");
    other = await registerTenant("Other Split Lodge", "hotel");
  }, 60_000);

  it("each guest's lines become their own sale and receipt; the order closes only when all are billed", async () => {
    const a = await meal("Rice", 200), b = await meal("Beans", 100), c = await meal("Tea", 50);
    const { o, items } = await order([[a, 1], [b, 2], [c, 1]]);
    const [rice, beans, tea] = ["Rice", "Beans", "Tea"].map((nm) => items.find((i) => i.name === nm).id);
    const g1 = await post(`/hotel/orders/${o}/bill`, owner, { itemIds: [rice, tea] });
    expect(g1.status, JSON.stringify(g1.body)).toBe(200);
    expect(Number(g1.body.data.sale.total)).toBe(250);
    expect(g1.body.data.order.status).toBe("open");
    expect(g1.body.data.order.runningTotal).toBe("200.00"); // what is left: 2 x Beans
    expect(g1.body.data.order.items.filter((i: any) => i.billedReceipt)).toHaveLength(2);
    const g2 = await post(`/hotel/orders/${o}/bill`, owner, { itemIds: [beans], paymentMethod: "mpesa", paymentReference: "QGH7XK2LMN" });
    expect(g2.status, JSON.stringify(g2.body)).toBe(200);
    expect(Number(g2.body.data.sale.total)).toBe(200);
    expect(g2.body.data.order.status).toBe("billed");
    expect(g2.body.data.sale.receiptNumber).not.toBe(g1.body.data.sale.receiptNumber);
    expect(await saleTotal(g1.body.data.sale.id) + await saleTotal(g2.body.data.sale.id)).toBe(450);
  });

  it("billing the rest without choosing bills only what is still unbilled", async () => {
    const a = await meal("Soup", 120), b = await meal("Bread", 30);
    const { o, items } = await order([[a, 1], [b, 1]]);
    await post(`/hotel/orders/${o}/bill`, owner, { itemIds: [items[0].id] });
    const rest = await post(`/hotel/orders/${o}/bill`, owner, {});
    expect(rest.status, JSON.stringify(rest.body)).toBe(200);
    expect(Number(rest.body.data.sale.total)).toBe(30);
    expect(rest.body.data.order.status).toBe("billed");
  });

  it("sending the same part-bill again returns the same receipt and never bills twice", async () => {
    const a = await meal("Fish", 500), b = await meal("Ugali", 60);
    const { o, items } = await order([[a, 1], [b, 1]]);
    const x = await post(`/hotel/orders/${o}/bill`, owner, { itemIds: [items[0].id] });
    const y = await post(`/hotel/orders/${o}/bill`, owner, { itemIds: [items[0].id] });
    expect(y.status).toBe(200);
    expect(y.body.data.alreadyBilled).toBe(true);
    expect(y.body.data.sale.id).toBe(x.body.data.sale.id);
    const c = await query<{ c: string }>(`select count(*) c from sales where notes like $1`, [`S${n}%`]);
    expect(Number(c[0]!.c)).toBe(1);
  });

  it("two tills billing the same line at once produce exactly one sale", async () => {
    const a = await meal("Steak", 900);
    const { o, items } = await order([[a, 1]]);
    const rs = await Promise.all([1, 2, 3].map(() => post(`/hotel/orders/${o}/bill`, owner, { itemIds: [items[0].id] })));
    expect(rs.every((r) => r.status === 200), JSON.stringify(rs.map((r) => r.body.message))).toBe(true);
    expect(new Set(rs.map((r) => r.body.data.sale.id)).size).toBe(1);
  });

  it("a line cannot be billed on two different bills, and cannot be changed or removed once billed", async () => {
    const a = await meal("Chips", 150), b = await meal("Salad", 90);
    const { o, items } = await order([[a, 1], [b, 1]]);
    await post(`/hotel/orders/${o}/bill`, owner, { itemIds: [items[0].id] });
    const both = await post(`/hotel/orders/${o}/bill`, owner, { itemIds: [items[0].id, items[1].id] });
    expect(both.status).toBe(409);
    expect((await put(`/hotel/orders/${o}/items/${items[0].id}`, owner, { quantity: 3 })).status).toBe(409);
    expect((await del(`/hotel/orders/${o}/items/${items[0].id}`, owner, {})).status).toBe(409);
    expect((await post(`/hotel/orders/${o}/cancel`, owner, { reason: "changed mind" })).status).toBe(409);
    // the unbilled line can still be removed, and new lines can be added and billed
    expect((await post(`/hotel/orders/${o}/items`, owner, { productId: a, quantity: 2 })).status).toBe(201);
    const rest = await post(`/hotel/orders/${o}/bill`, owner, {});
    expect(Number(rest.body.data.sale.total)).toBe(90 + 300);
  });

  it("bad choices are refused: nothing chosen, unknown line, another business's line", async () => {
    const a = await meal("Pie", 80);
    const { o, items } = await order([[a, 1]]);
    for (const bad of [[], "x", null]) expect((await post(`/hotel/orders/${o}/bill`, owner, { itemIds: bad })).status, JSON.stringify(bad)).toBe(400);
    expect((await post(`/hotel/orders/${o}/bill`, owner, { itemIds: ["00000000-0000-4000-8000-000000000000"] })).status).toBe(404);
    expect((await post(`/hotel/orders/${o}/bill`, other, { itemIds: [items[0].id] })).status).toBe(404);
    expect((await get(`/hotel/orders/${o}`, owner)).body.data.status).toBe("open");
  });

  it("service charge is worked out on each part separately", async () => {
    await put("/hotel/settings", owner, { serviceChargeRate: 10 });
    const a = await meal("Wine", 1000), b = await meal("Water", 100);
    const { o, items } = await order([[a, 1], [b, 1]]);
    const g1 = await post(`/hotel/orders/${o}/bill`, owner, { itemIds: [items[1].id] });
    expect(Number(g1.body.data.sale.total)).toBe(110);
    expect(g1.body.data.order.serviceCharge).toBe("100.00"); // on the 1000 still to bill
    const g2 = await post(`/hotel/orders/${o}/bill`, owner, {});
    expect(Number(g2.body.data.sale.total)).toBe(1100);
    await put("/hotel/settings", owner, { serviceChargeRate: 0 });
  });

  it("database rule: a removed line can never carry a sale", async () => {
    await expect(query(`update table_order_items set voided_at = now(), void_reason = 'x' where sale_id is not null and id = (select min(id) from table_order_items where sale_id is not null)`)).rejects.toThrow(/void_not_billed/);
  });
});
