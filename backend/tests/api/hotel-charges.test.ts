import { describe, it, expect, beforeAll } from "vitest";
import { query, resetData } from "../support/db.js";
import { del, get, post, put } from "../support/http.js";
import { addEmployee, registerTenant, type Tenant } from "../support/seed.js";

describe("hotel: service charge, catering levy and add-ons", () => {
  let owner: Tenant, other: Tenant, waiter: Tenant, vatLodge: Tenant;
  let n = 0;
  const meal = async (t: Tenant, name: string, price: number) => (await post("/products", t, { name, costPrice: 0, sellingPrice: price, tracksStock: false })).body.data.id as string;
  const open = async (t: Tenant) => {
    const tb = (await post("/hotel/tables", t, { name: `T${++n}` })).body.data.id;
    return (await post(`/hotel/tables/${tb}/orders`, t, {})).body.data.id as string;
  };

  beforeAll(async () => {
    await resetData();
    owner = await registerTenant("Charge Lodge", "hotel");
    other = await registerTenant("Other Charge Lodge", "hotel");
    vatLodge = await registerTenant("Vat Lodge", "hotel");
    waiter = await addEmployee(owner, "Cashier");
  }, 60_000);

  it("charges are off by default, so an untouched business bills exactly as before", async () => {
    expect((await get("/hotel/settings", owner)).body.data).toEqual({ serviceChargeRate: "0.00", cateringLevyRate: "0.00" });
    const o = await open(owner);
    await post(`/hotel/orders/${o}/items`, owner, { productId: await meal(owner, "Plain", 200), quantity: 1 });
    const b = await post(`/hotel/orders/${o}/bill`, owner, {});
    expect(Number(b.body.data.sale.total)).toBe(200);
    expect((await query<{ c: string }>(`select count(*) c from products where sku like 'SYS-%'`))[0]!.c).toBe("0");
  });

  it("only someone allowed to change settings can set the rates, and bad rates are refused", async () => {
    expect((await put("/hotel/settings", waiter, { serviceChargeRate: 10 })).status).toBe(403);
    for (const bad of [-1, 51, "abc", 1.234, null, ""]) {
      expect((await put("/hotel/settings", owner, { serviceChargeRate: bad })).status, String(bad)).toBe(400);
    }
    expect((await put("/hotel/settings", owner, {})).status).toBe(400);
    const ok = await put("/hotel/settings", owner, { serviceChargeRate: 10, cateringLevyRate: 2 });
    expect(ok.body.data).toEqual({ serviceChargeRate: "10.00", cateringLevyRate: "2.00" });
    expect((await get("/hotel/settings", waiter)).status).toBe(200);
    expect((await get("/hotel/settings", other)).body.data.serviceChargeRate).toBe("0.00");
  });

  it("the open order shows the charges, and billing records them as lines on the same sale", async () => {
    const dish = await meal(owner, "Steak", 1000);
    const o = await open(owner);
    const added = await post(`/hotel/orders/${o}/items`, owner, { productId: dish, quantity: 1 });
    expect(added.body.data.serviceCharge).toBe("100.00");
    expect(added.body.data.cateringLevy).toBe("20.00");
    expect(added.body.data.estimatedTotal).toBe("1120.00");
    const b = await post(`/hotel/orders/${o}/bill`, owner, {});
    expect(b.status, JSON.stringify(b.body)).toBe(200);
    expect(Number(b.body.data.sale.total)).toBe(1120);
    const lines = await query<{ name: string; total: string }>(`select p.name, si.total::text total from sale_items si join products p on p.id = si.product_id join sales s on s.id = si.sale_id where s.public_id = $1::uuid order by si.id`, [b.body.data.sale.id]);
    expect(lines.map((l) => [l.name, Number(l.total)])).toEqual([["Steak", 1000], ["Service charge", 100], ["Catering levy", 20]]);
    expect(((await get("/hotel/menu", owner)).body.data as any[]).map((m) => m.name)).not.toContain("Service charge");
    const stock = await query<{ c: string }>(`select count(*) c from branch_stock where product_id in (select id from products where sku like 'SYS-%')`);
    expect(Number(stock[0]!.c)).toBe(0);
  });

  it("charges round to whole cents the same way every time", async () => {
    const o = await open(owner);
    await post(`/hotel/orders/${o}/items`, owner, { productId: await meal(owner, "Odd price", 33.33), quantity: 3 }); // 99.99
    const b = await post(`/hotel/orders/${o}/bill`, owner, {});
    // 99.99 x 10% = 10.00 (9.999), 99.99 x 2% = 2.00 (1.9998)
    expect(Number(b.body.data.sale.total)).toBe(111.99);
  });

  it("changing the rate later does not alter a bill already issued", async () => {
    const o = await open(owner);
    await post(`/hotel/orders/${o}/items`, owner, { productId: await meal(owner, "Soup", 100), quantity: 1 });
    const b = await post(`/hotel/orders/${o}/bill`, owner, {});
    await put("/hotel/settings", owner, { serviceChargeRate: 5 });
    expect(Number((await query<{ t: string }>(`select total::text t from sales where public_id = $1::uuid`, [b.body.data.sale.id]))[0]!.t)).toBe(112);
    await put("/hotel/settings", owner, { serviceChargeRate: 10 });
  });

  it("a billed sale with charges can still be voided", async () => {
    const o = await open(owner);
    await post(`/hotel/orders/${o}/items`, owner, { productId: await meal(owner, "Fish", 300), quantity: 1 });
    const sale = (await post(`/hotel/orders/${o}/bill`, owner, {})).body.data.sale;
    expect((await post(`/sales/${sale.id}/void`, owner, { refundMethod: "cash", reason: "Wrong table" })).status).toBe(200);
  });

  it("add-ons add to the line price, merge only when identical, and are copied so later changes don't alter the bill", async () => {
    const cheese = (await post("/hotel/addons", owner, { name: "Extra cheese", price: 50 })).body.data.id;
    const egg = (await post("/hotel/addons", owner, { name: "Fried egg", price: 30 })).body.data.id;
    const dish = await meal(owner, "Burger", 450);
    await put("/hotel/settings", owner, { serviceChargeRate: 0, cateringLevyRate: 0 });
    const o = await open(owner);
    await post(`/hotel/orders/${o}/items`, owner, { productId: dish, quantity: 1 });
    await post(`/hotel/orders/${o}/items`, owner, { productId: dish, quantity: 1, addonIds: [cheese] });
    const r = await post(`/hotel/orders/${o}/items`, owner, { productId: dish, quantity: 1, addonIds: [cheese] });
    expect(r.body.data.items).toHaveLength(2);
    const withCheese = r.body.data.items.find((i: any) => i.addons.length);
    expect(Number(withCheese.quantity)).toBe(2);
    expect(withCheese.lineTotal).toBe("1000.00");
    const r2 = await post(`/hotel/orders/${o}/items`, owner, { productId: dish, quantity: 1, addonIds: [cheese, egg] });
    expect(r2.body.data.items).toHaveLength(3);
    expect(r2.body.data.runningTotal).toBe("1980.00"); // 450 + 2x500 + 530
    await del(`/hotel/addons/${cheese}`, owner);
    expect((await get(`/hotel/orders/${o}`, owner)).body.data.runningTotal).toBe("1980.00");
    const b = await post(`/hotel/orders/${o}/bill`, owner, {});
    expect(b.status, JSON.stringify(b.body)).toBe(200);
    expect(Number(b.body.data.sale.total)).toBe(1980);
  });

  it("an unsent line's quantity can be changed (add-ons kept); a sent line cannot", async () => {
    const cheese = (await post("/hotel/addons", owner, { name: "Bacon", price: 70 })).body.data.id;
    const dish = await meal(owner, "Toastie", 200);
    const o = await open(owner);
    const line = (await post(`/hotel/orders/${o}/items`, owner, { productId: dish, quantity: 1, addonIds: [cheese], note: "no onions" })).body.data.items[0];
    const r = await put(`/hotel/orders/${o}/items/${line.id}`, owner, { quantity: 3 });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.items[0].lineTotal).toBe("810.00"); // 3 x (200 + 70)
    expect(r.body.data.items[0].addons).toHaveLength(1);
    expect(r.body.data.items[0].note).toBe("no onions");
    for (const bad of [0, -1, "x", 1.2345]) expect((await put(`/hotel/orders/${o}/items/${line.id}`, owner, { quantity: bad })).status, String(bad)).toBe(400);
    expect((await put(`/hotel/orders/${o}/items/${line.id}`, other, { quantity: 2 })).status).toBe(404);
    const sent = await post(`/hotel/orders/${o}/send`, owner, {});
    expect(sent.body.data.sent[0].addons).toEqual(["Bacon"]);
    expect((await put(`/hotel/orders/${o}/items/${line.id}`, owner, { quantity: 2 })).status).toBe(409);
  });

  it("add-ons are managed by people with product access, are private to each business, and names are unique", async () => {
    expect((await post("/hotel/addons", waiter, { name: "Nope", price: 1 })).status).toBe(403);
    expect((await get("/hotel/addons", waiter)).status).toBe(200);
    const a = await post("/hotel/addons", owner, { name: "Chilli", price: 10 });
    expect((await post("/hotel/addons", owner, { name: "Chilli", price: 10 })).status).toBe(409);
    for (const bad of [-5, "x", 1.234]) expect((await post("/hotel/addons", owner, { name: "Bad", price: bad })).status, String(bad)).toBe(400);
    expect((await get("/hotel/addons", other)).body.data).toEqual([]);
    const o = await open(other);
    expect((await post(`/hotel/orders/${o}/items`, other, { productId: await meal(other, "Own dish", 10), addonIds: [a.body.data.id] })).status).toBe(404);
    expect((await del(`/hotel/addons/${a.body.data.id}`, other)).status).toBe(404);
    expect((await del(`/hotel/addons/${a.body.data.id}`, owner)).status).toBe(200);
    expect((await post("/hotel/addons", owner, { name: "Chilli", price: 12 })).status).toBe(201); // the name can be reused
  });

  it("VAT is worked out by the existing sale code on the charge lines too", async () => {
    await query(`update businesses set vat_registered = true, vat_rate = 16, prices_include_vat = false where id = $1`, [vatLodge.businessId]);
    await put("/hotel/settings", vatLodge, { serviceChargeRate: 10, cateringLevyRate: 2 });
    const o = await open(vatLodge);
    await post(`/hotel/orders/${o}/items`, vatLodge, { productId: await meal(vatLodge, "Lamb", 1000), quantity: 1 });
    const b = await post(`/hotel/orders/${o}/bill`, vatLodge, {});
    expect(b.status, JSON.stringify(b.body)).toBe(200);
    expect(Number(b.body.data.sale.subtotal)).toBe(1120);
    expect(Number(b.body.data.sale.tax)).toBe(179.2); // 16% of 1120: charges follow the same tax class as food
    expect(Number(b.body.data.sale.total)).toBe(1299.2);
  });

  it("the normal sales endpoint still refuses a price that is not the saved price, trusted-price billing is not reachable from outside", async () => {
    const dish = await meal(owner, "Guarded", 100);
    const r = await post("/sales", owner, { amountPaid: 1, paymentMethod: "cash", trustedPrices: true, items: [{ productId: dish, quantity: 1, unitPrice: 1 }] });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/does not match the saved selling price/);
  });

  it("database rules: rates stay between 0 and 50, add-on prices are not negative, add-ons are a list", async () => {
    await expect(query(`update businesses set service_charge_rate = 51 where id = $1`, [owner.businessId])).rejects.toThrow(/service_charge_range/);
    await expect(query(`update businesses set catering_levy_rate = -1 where id = $1`, [owner.businessId])).rejects.toThrow(/catering_levy_range/);
    await expect(query(`update menu_addons set price = -1 where id = (select min(id) from menu_addons)`)).rejects.toThrow(/price_nonneg/);
    await expect(query(`update table_order_items set addons = '{"a":1}'::jsonb where id = (select min(id) from table_order_items)`)).rejects.toThrow(/addons_array/);
  });
});
