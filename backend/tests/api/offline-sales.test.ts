import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { query, resetData } from "../support/db.js";
import { loadTestConfig } from "../support/env.js";
import { startServer, waitForHealth, type RunningServer } from "../support/server.js";
import { addEmployee, createProduct, registerTenant, type Tenant } from "../support/seed.js";

const cfg = loadTestConfig();
const PORT = cfg.apiPort + 11;
const BASE = `http://localhost:${PORT}/api`;

async function call(method: string, path: string, t: Tenant, body?: unknown, extra: Record<string, string> = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", "X-Auth-Mode": "bearer", Authorization: `Bearer ${t.token}`, "X-Business-ID": t.businessPublicId, ...extra },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: (await res.json()) as any };
}
let n = 0;

describe("offline sales: recorded even when stock ran out, shortfall flagged for review", () => {
  let server: RunningServer;
  let owner: Tenant, other: Tenant, viewer: Tenant, cashier: Tenant;

  const stockOf = async (t: Tenant, productPublicId: string) =>
    Number((await query<{ q: string }>(
      `select coalesce(sum(bs.quantity),0)::text q from branch_stock bs join products p on p.id = bs.product_id where p.public_id = $1::uuid and bs.business_id = $2`,
      [productPublicId, t.businessId]))[0]!.q);
  const sell = (t: Tenant, productId: string, qty: number, over: Record<string, unknown> = {}, key = `off-${Date.now()}-${++n}-abcdef`) =>
    call("POST", "/sales", t, { amountPaid: qty * 100, paymentMethod: "cash", items: [{ productId, quantity: qty, unitPrice: 100 }], ...over }, { "Idempotency-Key": key });
  const when = () => new Date(Date.now() - 3600_000).toISOString();
  const product = async (stock: number, name = `Item ${++n}`) => (await createProduct(owner, { name, costPrice: 50, sellingPrice: 100, stockQuantity: stock })).id as string;

  beforeAll(async () => {
    await resetData();
    server = startServer(PORT, {});
    await waitForHealth(`http://localhost:${PORT}/api/health`, 40_000, server);
    owner = await registerTenant("Offline Shop");
    other = await registerTenant("Other Offline Shop");
    viewer = await addEmployee(owner, "Viewer", ["inventory.view"]);
    cashier = await addEmployee(owner, "Cashier");
  }, 120_000);
  afterAll(async () => { await server?.stop(); });

  it("an offline sale with enough stock behaves like a normal one and remembers when it happened", async () => {
    const p = await product(10);
    const at = when();
    const r = await sell(owner, p, 4, { offlineSoldAt: at });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data.stockShortfall).toBe(false);
    expect(await stockOf(owner, p)).toBe(6);
    const [row] = await query<{ t: Date }>(`select offline_sold_at t from sales where public_id = $1::uuid`, [r.body.data.id]);
    expect(Math.abs(row!.t.getTime() - new Date(at).getTime())).toBeLessThan(1000);
  });

  it("when stock ran out the sale is still recorded, stock stops at zero, and the shortfall is listed", async () => {
    const p = await product(2);
    const r = await sell(owner, p, 5, { offlineSoldAt: when() });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data.stockShortfall).toBe(true);
    expect(Number(r.body.data.total)).toBe(500);
    expect(Number(r.body.data.amountPaid)).toBe(500);
    expect(await stockOf(owner, p)).toBe(0);
    const mv = await query<{ q: string }>(`select quantity::text q from inventory_movements where reference = $1`, [`SALE-${(await query<{ id: string }>(`select id::text from sales where public_id = $1::uuid`, [r.body.data.id]))[0]!.id}`]);
    expect(mv.map((m) => Number(m.q))).toEqual([2]); // only what was really taken
    const list = await call("GET", "/inventory/offline-shortfalls", owner);
    const item = list.body.data.find((x: any) => x.receiptNumber === r.body.data.receiptNumber);
    expect(Number(item.quantityShort)).toBe(3);
    expect(item.resolvedAt).toBeNull();
    const pays = await query<{ c: string }>(`select count(*) c from payments where sale_id = (select id from sales where public_id = $1::uuid)`, [r.body.data.id]);
    expect(Number(pays[0]!.c)).toBe(1);
  });

  it("a product with no stock at all is still sold, with no stock movement", async () => {
    const p = await product(0);
    const r = await sell(owner, p, 3, { offlineSoldAt: when() });
    expect(r.status).toBe(201);
    expect(r.body.data.stockShortfall).toBe(true);
    expect(await stockOf(owner, p)).toBe(0);
    const mv = await query<{ c: string }>(`select count(*) c from inventory_movements where type = 'OUT' and product_id = (select id from products where public_id = $1::uuid)`, [p]);
    expect(Number(mv[0]!.c)).toBe(0);
  });

  it("an online sale (no offline marker) is refused when stock is short, exactly as before", async () => {
    const p = await product(1);
    const r = await sell(owner, p, 2);
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/Insufficient stock/);
    expect(await stockOf(owner, p)).toBe(1);
  });

  it("the offline time must be real, recent and not in the future", async () => {
    const p = await product(50);
    for (const bad of ["yesterday", "", new Date(Date.now() + 3600_000).toISOString(), new Date(Date.now() - 20 * 86400_000).toISOString()]) {
      const r = await sell(owner, p, 1, { offlineSoldAt: bad });
      expect(r.status, String(bad)).toBe(400);
    }
    expect(await stockOf(owner, p)).toBe(50);
  });

  it("sending the same offline sale again records it once, with one shortfall", async () => {
    const p = await product(1);
    const key = "off-replay-0001-abcdef";
    const a = await sell(owner, p, 4, { offlineSoldAt: when() }, key);
    const b = await sell(owner, p, 4, { offlineSoldAt: when() }, key);
    expect(a.status).toBe(201);
    expect(b.body.data.id).toBe(a.body.data.id);
    const c = await query<{ c: string }>(`select count(*) c from offline_stock_shortfalls where sale_id = (select id from sales where public_id = $1::uuid)`, [a.body.data.id]);
    expect(Number(c[0]!.c)).toBe(1);
    expect(await stockOf(owner, p)).toBe(0);
  });

  it("several offline tills racing for the same stock never take more than exists", async () => {
    const p = await product(5);
    const rs = await Promise.all([1, 2, 3].map(() => sell(owner, p, 3, { offlineSoldAt: when() })));
    // A rare collision may make one attempt answer an error to be retried; none may oversell.
    const ok = rs.filter((r) => r.status === 201);
    expect(ok.length).toBeGreaterThanOrEqual(1);
    expect(await stockOf(owner, p)).toBeGreaterThanOrEqual(0);
    const short = await query<{ s: string }>(`select coalesce(sum(quantity_short),0)::text s from offline_stock_shortfalls where product_id = (select id from products where public_id = $1::uuid)`, [p]);
    const sold = ok.length * 3;
    expect(5 - (await stockOf(owner, p))).toBe(sold - Number(short[0]!.s)); // taken = sold - shortfall
  });

  it("the shortfall list needs inventory.view, is private to each business, and resolving needs inventory.adjust and a reason", async () => {
    const p = await product(0);
    const r = await sell(owner, p, 2, { offlineSoldAt: when() });
    expect(r.status).toBe(201);
    expect((await call("GET", "/inventory/offline-shortfalls", viewer)).status).toBe(200);
    expect((await call("GET", "/inventory/offline-shortfalls", cashier)).status).toBe(403);
    const mine = (await call("GET", "/inventory/offline-shortfalls", owner)).body.data.find((x: any) => x.receiptNumber === r.body.data.receiptNumber);
    expect((await call("GET", "/inventory/offline-shortfalls", other)).body.data).toEqual([]);
    const url = `/inventory/offline-shortfalls/${mine.id}/resolve`;
    expect((await call("POST", url, viewer, { note: "Recounted the shelf" })).status).toBe(403);
    expect((await call("POST", url, other, { note: "Recounted the shelf" })).status).toBe(404);
    expect((await call("POST", url, owner, { note: "ok" })).status).toBe(400);
    const before = await stockOf(owner, p);
    expect((await call("POST", url, owner, { note: "Recounted the shelf" })).status).toBe(200);
    expect((await call("POST", url, owner, { note: "Recounted the shelf" })).status).toBe(409);
    expect(await stockOf(owner, p)).toBe(before); // resolving never touches stock
    const after = (await call("GET", "/inventory/offline-shortfalls", owner)).body.data.find((x: any) => x.id === mine.id);
    expect(after.resolvedNote).toBe("Recounted the shelf");
  });

  it("the database still refuses negative stock and bad shortfall rows", async () => {
    await expect(query(`update branch_stock set quantity = -1 where ctid = (select ctid from branch_stock limit 1)`)).rejects.toThrow(/nonneg/);
    await expect(query(`update offline_stock_shortfalls set quantity_short = 0 where ctid = (select ctid from offline_stock_shortfalls limit 1)`)).rejects.toThrow(/qty_positive/);
    await expect(query(`update offline_stock_shortfalls set resolved_at = now() where ctid = (select ctid from offline_stock_shortfalls where resolved_at is null limit 1)`)).rejects.toThrow(/resolved_complete/);
  });
});
