import { describe, it, expect, beforeAll } from "vitest";
import { query, resetData } from "../support/db.js";
import { get, post, put } from "../support/http.js";
import { addEmployee, ledgerViolations, mpesaCode, registerTenant, type Tenant } from "../support/seed.js";

describe("hotel: stays and charge-to-room", () => {
  let owner: Tenant, other: Tenant;
  let n = 0;
  const meal = async (t: Tenant, name: string, price: number) => (await post("/products", t, { name, costPrice: 0, sellingPrice: price, tracksStock: false })).body.data.id as string;
  const order = async (t: Tenant, lines: [string, number][]) => {
    const tb = (await post("/hotel/tables", t, { name: `R${++n}` })).body.data.id;
    const o = (await post(`/hotel/tables/${tb}/orders`, t, {})).body.data.id as string;
    let last: any;
    for (const [p, q] of lines) last = await post(`/hotel/orders/${o}/items`, t, { productId: p, quantity: q });
    return { o, items: last.body.data.items as any[] };
  };
  const checkIn = async (room: string, extra: Record<string, unknown> = {}, t: Tenant = owner) => {
    const r = await post("/hotel/stays", t, { roomName: room, guestName: `Guest ${room}`, ...extra });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body.data;
  };
  const customerBalance = async (name: string) => Number((await query<{ b: string }>(`select balance::text b from customers where name = $1`, [name]))[0]!.b);

  beforeAll(async () => {
    await resetData();
    owner = await registerTenant("Stay Hotel", "hotel");
    other = await registerTenant("Other Stay Hotel", "hotel");
  }, 60_000);

  it("check-in creates the guest as a customer and the stay shows an empty folio", async () => {
    const s = await checkIn("101", { phone: "0711000111", creditLimit: 5000 });
    expect(s.status).toBe("in_house");
    expect(s.guest.name).toBe("Guest 101");
    expect(s.totals.owed).toBe("0.00");
    expect(s.totals.creditHeadroom).toBe("5000.00");
    const c = await query<{ n: string }>(`select count(*) n from customers where name = 'Guest 101'`);
    expect(Number(c[0]!.n)).toBe(1);
  });

  it("one in-house guest per room, case-insensitive; the room frees up after check-out", async () => {
    await checkIn("102");
    const dup = await post("/hotel/stays", owner, { roomName: "102", guestName: "Someone else" });
    expect(dup.status).toBe(409);
    const dup2 = await post("/hotel/stays", owner, { roomName: " 102 ".trim().toLowerCase(), guestName: "Someone else" });
    expect(dup2.status).toBe(409);
    const list = (await get("/hotel/stays", owner)).body.data as any[];
    const id = list.find((s) => s.roomName === "102").id;
    const out = await post(`/hotel/stays/${id}/checkout`, owner, {});
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    expect((await post("/hotel/stays", owner, { roomName: "102", guestName: "New guest" })).status).toBe(201);
  });

  it("an existing customer can be the guest, and invalid input is refused", async () => {
    const cust = (await post("/customers", owner, { name: "Regular Guest", phone: "0722000222" })).body.data.id;
    const s = await checkIn("103", { customerId: cust, guestName: undefined });
    expect(s.guest.id).toBe(cust);
    expect((await post("/hotel/stays", owner, { roomName: "", guestName: "x" })).status).toBe(400);
    expect((await post("/hotel/stays", owner, { roomName: "104" })).status).toBe(400);
    expect((await post("/hotel/stays", owner, { roomName: "104", guestName: "x", creditLimit: -5 })).status).toBe(400);
    expect((await post("/hotel/stays", owner, { roomName: "104", guestName: "x", deposit: { amount: 1000 } })).status).toBe(400); // method missing
  });

  it("charging a table bill to a room makes an unpaid sale on the guest's account and shows on the folio", async () => {
    const stay = await checkIn("201");
    const rice = await meal(owner, "Rice 201", 250);
    const { o } = await order(owner, [[rice, 2]]);
    const r = await post(`/hotel/orders/${o}/bill`, owner, { stayId: stay.id });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.order.status).toBe("billed");
    expect(Number(r.body.data.sale.total)).toBe(500);
    expect(Number(r.body.data.sale.amountPaid)).toBe(0);
    expect(Number(r.body.data.sale.balanceDue)).toBe(500);
    expect(await customerBalance("Guest 201")).toBe(500);
    const f = (await get(`/hotel/stays/${stay.id}`, owner)).body.data;
    expect(f.charges).toHaveLength(1);
    expect(f.totals.owed).toBe("500.00");
    expect(f.charges[0].receiptNumber).toBe(r.body.data.sale.receiptNumber);
    expect(await ledgerViolations()).toEqual([]);
  });

  it("billing the same order to the room twice (retry) charges once", async () => {
    const stay = await checkIn("202");
    const p = await meal(owner, "Soup 202", 300);
    const { o } = await order(owner, [[p, 1]]);
    const a = await post(`/hotel/orders/${o}/bill`, owner, { stayId: stay.id });
    const b = await post(`/hotel/orders/${o}/bill`, owner, { stayId: stay.id });
    expect(b.status).toBe(200);
    expect(b.body.data.sale.id).toBe(a.body.data.sale.id);
    expect(await customerBalance("Guest 202")).toBe(300);
    expect((await get(`/hotel/stays/${stay.id}`, owner)).body.data.charges).toHaveLength(1);
  });

  it("a split bill can send one part to the room and another part is paid at the till", async () => {
    const stay = await checkIn("203");
    const a = await meal(owner, "Pasta 203", 400), b = await meal(owner, "Juice 203", 100);
    const { o, items } = await order(owner, [[a, 1], [b, 1]]);
    const pasta = items.find((i) => i.name === "Pasta 203").id;
    const juice = items.find((i) => i.name === "Juice 203").id;
    const toRoom = await post(`/hotel/orders/${o}/bill`, owner, { itemIds: [pasta], stayId: stay.id });
    expect(toRoom.status, JSON.stringify(toRoom.body)).toBe(200);
    expect(toRoom.body.data.order.status).toBe("open");
    const cash = await post(`/hotel/orders/${o}/bill`, owner, { itemIds: [juice] });
    expect(cash.status).toBe(200);
    expect(cash.body.data.order.status).toBe("billed");
    expect(Number(cash.body.data.sale.balanceDue)).toBe(0);
    expect(await customerBalance("Guest 203")).toBe(400);
  });

  it("the stay's credit limit stops a charge that would go over it, and nothing is created", async () => {
    const stay = await checkIn("204", { creditLimit: 1000 });
    const p = await meal(owner, "Steak 204", 600);
    const o1 = await order(owner, [[p, 1]]);
    expect((await post(`/hotel/orders/${o1.o}/bill`, owner, { stayId: stay.id })).status).toBe(200);
    const o2 = await order(owner, [[p, 1]]);
    const over = await post(`/hotel/orders/${o2.o}/bill`, owner, { stayId: stay.id });
    expect(over.status).toBe(400);
    expect(over.body.message).toMatch(/credit limit exceeded/i);
    expect(await customerBalance("Guest 204")).toBe(600);
    const again = await get(`/hotel/orders/${o2.o}`, owner);
    expect(again.body.data.status).toBe("open");
    // Raising the limit lets the same bill through.
    expect((await put(`/hotel/stays/${stay.id}`, owner, { creditLimit: 2000 })).status).toBe(200);
    expect((await post(`/hotel/orders/${o2.o}/bill`, owner, { stayId: stay.id })).status).toBe(200);
    expect(await customerBalance("Guest 204")).toBe(1200);
  });

  it("concurrent charges cannot together exceed the stay's limit", async () => {
    const stay = await checkIn("205", { creditLimit: 1000 });
    const p = await meal(owner, "Lobster 205", 600);
    const orders = await Promise.all([order(owner, [[p, 1]]), order(owner, [[p, 1]]), order(owner, [[p, 1]])]);
    const rs = await Promise.all(orders.map((x) => post(`/hotel/orders/${x.o}/bill`, owner, { stayId: stay.id })));
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 400)).toHaveLength(2);
    expect(await customerBalance("Guest 205")).toBe(600);
  });

  it("a bill charged to a room is not paid at the till, and a checked-out or unknown room is refused", async () => {
    const stay = await checkIn("206");
    const p = await meal(owner, "Tea 206", 100);
    const { o } = await order(owner, [[p, 1]]);
    const paid = await post(`/hotel/orders/${o}/bill`, owner, { stayId: stay.id, amountPaid: 100, paymentMethod: "cash" });
    expect(paid.status).toBe(400);
    expect((await post(`/hotel/stays/${stay.id}/checkout`, owner, {})).status).toBe(200);
    const closed = await post(`/hotel/orders/${o}/bill`, owner, { stayId: stay.id });
    expect(closed.status).toBe(409);
    const nope = await post(`/hotel/orders/${o}/bill`, owner, { stayId: "00000000-0000-4000-8000-000000000000" });
    expect(nope.status).toBe(404);
  });

  it("another business cannot see or charge to this business's stays", async () => {
    const stay = await checkIn("207");
    const p = await meal(other, "Tea X", 100);
    const { o } = await order(other, [[p, 1]]);
    expect((await get(`/hotel/stays/${stay.id}`, other)).status).toBe(404);
    expect((await post(`/hotel/orders/${o}/bill`, other, { stayId: stay.id })).status).toBe(404);
    expect((await post(`/hotel/stays/${stay.id}/checkout`, other, {})).status).toBe(404);
  });

  it("charging to a room needs its own permission; managing stays needs another", async () => {
    const stay = await checkIn("208");
    const till = await addEmployee(owner, "till only", ["sales.create", "products.view"]);
    const charger = await addEmployee(owner, "room charger", ["sales.create", "products.view", "hotel.charge_room"]);
    const p = await meal(owner, "Bread 208", 50);
    const a = await order(owner, [[p, 1]]);
    const denied = await post(`/hotel/orders/${a.o}/bill`, till, { stayId: stay.id });
    expect(denied.status).toBe(403);
    // The same cashier can still bill and take payment normally.
    expect((await post(`/hotel/orders/${a.o}/bill`, till, {})).status).toBe(200);
    const b = await order(owner, [[p, 1]]);
    expect((await post(`/hotel/orders/${b.o}/bill`, charger, { stayId: stay.id })).status).toBe(200);
    expect((await get("/hotel/stays/charge-targets", charger)).status).toBe(200);
    expect((await get("/hotel/stays/charge-targets", till)).status).toBe(403);
    expect((await get("/hotel/stays", charger)).status).toBe(403);
    expect((await post("/hotel/stays", charger, { roomName: "999", guestName: "x" })).status).toBe(403);
    expect((await post(`/hotel/stays/${stay.id}/checkout`, charger, {})).status).toBe(403);
  });

  describe("check-out", () => {
    const charged = async (room: string, price: number, extra: Record<string, unknown> = {}) => {
      const stay = await checkIn(room, extra);
      const p = await meal(owner, `Dish ${room}`, price);
      const { o } = await order(owner, [[p, 1]]);
      expect((await post(`/hotel/orders/${o}/bill`, owner, { stayId: stay.id })).status).toBe(200);
      return stay.id as string;
    };

    it("is blocked until the account is paid in full, and changes nothing when blocked", async () => {
      const id = await charged("301", 1000);
      const none = await post(`/hotel/stays/${id}/checkout`, owner, {});
      expect(none.status).toBe(400);
      expect(none.body.message).toMatch(/paid in full/i);
      const short = await post(`/hotel/stays/${id}/checkout`, owner, { payments: [{ method: "cash", amount: 900 }] });
      expect(short.status).toBe(400);
      const over = await post(`/hotel/stays/${id}/checkout`, owner, { payments: [{ method: "cash", amount: 1100 }] });
      expect(over.status).toBe(400);
      expect((await get(`/hotel/stays/${id}`, owner)).body.data.status).toBe("in_house");
      expect(await customerBalance("Guest 301")).toBe(1000);
      const pays = await query<{ n: string }>(`select count(*) n from payments where notes like 'Room 301 check-out%'`);
      expect(Number(pays[0]!.n)).toBe(0);
    });

    it("settles the account with split payments (cash + M-Pesa), clears the guest's balance and closes the stay", async () => {
      const id = await charged("302", 1000);
      const code = mpesaCode();
      const r = await post(`/hotel/stays/${id}/checkout`, owner, { payments: [{ method: "cash", amount: 400 }, { method: "mpesa", amount: 600, reference: code }] });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.data.status).toBe("checked_out");
      expect(r.body.data.totals.owed).toBe("0.00");
      expect(r.body.data.charges[0].balanceDue).toBe("0.00");
      expect(await customerBalance("Guest 302")).toBe(0);
      const sale = await query<{ s: string }>(`select payment_status s from sales s join hotel_stay_sales l on l.sale_id = s.id join hotel_stays h on h.id = l.stay_id where h.room_name = '302'`);
      expect(sale[0]!.s).toBe("paid");
      const pays = await query<{ method: string; amount: string }>(`select method, amount::text from payments where notes like 'Room 302 check-out%' order by id`);
      expect(pays.map((p) => `${p.method}:${Number(p.amount)}`)).toEqual(["cash:400", "mpesa:600"]);
      expect(await ledgerViolations()).toEqual([]);
    });

    it("a repeated check-out is harmless and takes no second payment", async () => {
      const id = await charged("303", 500);
      const body = { payments: [{ method: "cash", amount: 500 }] };
      expect((await post(`/hotel/stays/${id}/checkout`, owner, body)).status).toBe(200);
      const again = await post(`/hotel/stays/${id}/checkout`, owner, body);
      expect(again.status).toBe(200);
      expect(again.body.data.alreadyCheckedOut).toBe(true);
      const pays = await query<{ n: string }>(`select count(*) n from payments where notes like 'Room 303 check-out%'`);
      expect(Number(pays[0]!.n)).toBe(1);
    });

    it("a deposit is applied first; the guest pays only the rest", async () => {
      const id = await charged("304", 1000, { deposit: { amount: 600, method: "cash" } });
      const before = (await get(`/hotel/stays/${id}`, owner)).body.data;
      expect(before.deposit.available).toBe("600.00");
      expect(before.totals.dueAtCheckout).toBe("400.00");
      expect((await post(`/hotel/stays/${id}/checkout`, owner, { payments: [{ method: "cash", amount: 500 }] })).status).toBe(400);
      const r = await post(`/hotel/stays/${id}/checkout`, owner, { payments: [{ method: "cash", amount: 400 }] });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.data.deposit.applied).toBe("600.00");
      expect(r.body.data.deposit.refunded).toBe("0.00");
      const pays = await query<{ method: string; amount: string }>(`select method, amount::text from payments where notes like 'Room 304 check-out%' order by id`);
      expect(pays.map((p) => `${p.method}:${Number(p.amount)}`)).toEqual(["deposit:600", "cash:400"]);
      expect(await customerBalance("Guest 304")).toBe(0);
    });

    it("a deposit bigger than the account covers it with no payment, and the excess must be recorded as refunded", async () => {
      const id = await charged("305", 300, { deposit: { amount: 1000, method: "mpesa", reference: mpesaCode() } });
      const noRefund = await post(`/hotel/stays/${id}/checkout`, owner, {});
      expect(noRefund.status).toBe(400);
      expect(noRefund.body.message).toMatch(/refund method/i);
      const extraPay = await post(`/hotel/stays/${id}/checkout`, owner, { refundMethod: "cash", payments: [{ method: "cash", amount: 50 }] });
      expect(extraPay.status).toBe(400);
      const r = await post(`/hotel/stays/${id}/checkout`, owner, { refundMethod: "cash" });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.data.deposit.applied).toBe("300.00");
      expect(r.body.data.deposit.refunded).toBe("700.00");
      expect(r.body.data.deposit.refundMethod).toBe("cash");
      expect(await customerBalance("Guest 305")).toBe(0);
    });

    it("a stay with no charges can check out with nothing to pay; a deposit then goes back to the guest", async () => {
      const s = await checkIn("306", { deposit: { amount: 200, method: "cash" } });
      const r = await post(`/hotel/stays/${s.id}/checkout`, owner, { refundMethod: "cash" });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.data.deposit.refunded).toBe("200.00");
    });

    it("an M-Pesa code already used cannot be used again at check-out", async () => {
      const code = mpesaCode();
      const a = await charged("307", 100);
      expect((await post(`/hotel/stays/${a}/checkout`, owner, { payments: [{ method: "mpesa", amount: 100, reference: code }] })).status).toBe(200);
      const b = await charged("308", 100);
      const clash = await post(`/hotel/stays/${b}/checkout`, owner, { payments: [{ method: "mpesa", amount: 100, reference: code }] });
      expect(clash.status).toBe(409);
      expect((await get(`/hotel/stays/${b}`, owner)).body.data.status).toBe("in_house");
    });

    it("room charges are settled oldest first, across several bills, and other customers' debts are untouched", async () => {
      const stay = await checkIn("309");
      const p = await meal(owner, "Dish 309", 200);
      for (let i = 0; i < 3; i++) {
        const { o } = await order(owner, [[p, 1]]);
        expect((await post(`/hotel/orders/${o}/bill`, owner, { stayId: stay.id })).status).toBe(200);
      }
      // Same guest also owes an unrelated debt that does not belong to the stay.
      const guestId = stay.guest.id as string;
      const walk = await post("/sales", owner, { customerId: guestId, items: [{ productId: p, quantity: 1, unitPrice: 200 }], amountPaid: 0 });
      expect(walk.status, JSON.stringify(walk.body)).toBe(201);
      expect(await customerBalance("Guest 309")).toBe(800);
      const r = await post(`/hotel/stays/${stay.id}/checkout`, owner, { payments: [{ method: "cash", amount: 600 }] });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.data.charges.map((c: any) => c.balanceDue)).toEqual(["0.00", "0.00", "0.00"]);
      expect(await customerBalance("Guest 309")).toBe(200); // the unrelated sale is still owed
      expect(await ledgerViolations()).toEqual([]);
    });
  });

  it("the database refuses an inconsistent stay (deposit used beyond what was paid, or a bad status)", async () => {
    const s = await checkIn("401", { deposit: { amount: 100, method: "cash" } });
    await expect(query(`update hotel_stays set deposit_applied = 150 where public_id = $1::uuid`, [s.id])).rejects.toThrow(/hotel_stays_deposit_within/);
    await expect(query(`update hotel_stays set status = 'maybe' where public_id = $1::uuid`, [s.id])).rejects.toThrow(/hotel_stays_status_valid|hotel_stays_checkout_consistent/);
    await expect(query(`update hotel_stays set status = 'checked_out' where public_id = $1::uuid`, [s.id])).rejects.toThrow(/hotel_stays_checkout_consistent/);
  });
});
