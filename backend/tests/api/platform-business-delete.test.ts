import { describe, it, expect, beforeAll } from "vitest";
import bcrypt from "bcryptjs";
import { query, resetData } from "../support/db.js";
import { loadTestConfig } from "../support/env.js";
import { api, get, post } from "../support/http.js";
import { addEmployee, createCustomer, createProduct, createSupplier, registerTenant, mpesaCode } from "../support/seed.js";
import { encryptSecret, newTotpSecret, stepAt, totpAt } from "../../src/platform/totp.js";

process.env.JWT_SECRET = loadTestConfig().jwtSecret;
const PW = "Platform-Admin-Pass-1";

describe("super admin: delete, restore and erase a business", () => {
  let token: string;
  let doomed: Awaited<ReturnType<typeof registerTenant>>;
  let safe: Awaited<ReturnType<typeof registerTenant>>;
  let doomedWorker: Awaited<ReturnType<typeof addEmployee>>;
  const bearer = (t: string) => ({ token: t } as any);
  const adminPost = (path: string, body: unknown) => api("POST", `/platform${path}`, { session: bearer(token), body });
  const overview = async () => (await api("GET", "/platform/overview", { session: bearer(token) })).body.data;
  /** Rows per table that carry a business_id, for one business. */
  async function rowsFor(businessId: string) {
    const tables = await query<{ table_name: string }>(`select c.table_name from information_schema.columns c join information_schema.tables t using (table_schema, table_name) where c.table_schema='public' and c.column_name='business_id' and t.table_type='BASE TABLE' and c.table_name <> 'platform_audit_logs'`);
    const out: Record<string, number> = {};
    for (const { table_name } of tables) {
      const r = await query<{ n: number }>(`select count(*)::int as n from "${table_name}" where business_id = $1`, [businessId]);
      if (r[0]!.n > 0) out[table_name] = r[0]!.n;
    }
    return out;
  }

  beforeAll(async () => {
    await resetData();
    const secret = newTotpSecret();
    await query(`insert into platform_admins(name, email, password_hash, totp_secret_enc) values ('Boss', 'boss@nexa.test', $1, $2)`, [await bcrypt.hash(PW, 4), encryptSecret(secret)]);
    doomed = await registerTenant("Doomed Shop");
    safe = await registerTenant("Safe Shop");
    for (const t of [doomed, safe]) {
      const p = await createProduct(t, { name: "Soda", costPrice: 40, sellingPrice: 100, stockQuantity: 50 });
      await createCustomer(t, "Walk-in Wanjiru", "0712345678");
      await createSupplier(t, "Supplier Ltd");
      await post("/sales", t, { amountPaid: 200, paymentMethod: "cash", items: [{ productId: p.id, quantity: 2, unitPrice: 100 }] });
      await post("/sales", t, { amountPaid: 100, paymentMethod: "mpesa", paymentReference: mpesaCode(), items: [{ productId: p.id, quantity: 1, unitPrice: 100 }] });
    }
    doomedWorker = await addEmployee(doomed, "cashier");
    const login = await api("POST", "/platform/login", { body: { email: "boss@nexa.test", password: PW, code: totpAt(secret, stepAt(Date.now())) } });
    expect(login.status, JSON.stringify(login.body)).toBe(200);
    token = login.body.data.token;
  }, 90_000);

  it("deleting needs a reason", async () => {
    const id = doomed.businessPublicId;
    expect((await adminPost(`/businesses/${id}/delete`, {})).status).toBe(400);
    expect((await adminPost(`/businesses/${id}/delete`, { reason: " " })).status).toBe(400);
    expect((await get("/products", doomed)).status).toBe(200); // nothing happened yet
  });

  it("hides it: nobody can use it, it leaves the main list, nothing is removed", async () => {
    const before = await rowsFor(doomed.businessId);
    const r = await adminPost(`/businesses/${doomed.businessPublicId}/delete`, { reason: "Asked to close" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await get("/products", doomed)).status).toBe(403);
    expect((await get("/products", doomedWorker)).status).toBe(403);
    const signin = await post("/auth/login", undefined, { email: doomed.email, password: "Test-Pass-1234" });
    expect(JSON.stringify(signin.body.data?.businesses ?? [])).not.toContain("Doomed Shop");
    const o = await overview();
    expect(o.businesses.some((b: any) => b.name === "Doomed Shop")).toBe(false);
    expect(o.deleted.some((b: any) => b.name === "Doomed Shop")).toBe(true);
    expect(o.totals.businesses).toBe(o.businesses.length); // the hidden one is not counted
    expect(await rowsFor(doomed.businessId)).toEqual(before);
    expect((await adminPost(`/businesses/${doomed.businessPublicId}/delete`, { reason: "again" })).status).toBe(409);
  });

  it("restores it with everything intact", async () => {
    expect((await adminPost(`/businesses/${doomed.businessPublicId}/restore`, {})).status).toBe(400); // reason needed
    expect((await adminPost(`/businesses/${doomed.businessPublicId}/restore`, { reason: "Changed their mind" })).status).toBe(200);
    expect((await get("/products", doomed)).status).toBe(200);
    expect((await get("/products", doomedWorker)).status).toBe(200);
    expect((await overview()).deleted).toHaveLength(0);
  });

  it("refuses to erase a business that was not deleted first, or with the wrong name", async () => {
    const id = doomed.businessPublicId;
    expect((await adminPost(`/businesses/${id}/erase`, { reason: "Cleanup", confirmName: "Doomed Shop" })).status).toBe(409);
    await adminPost(`/businesses/${id}/delete`, { reason: "Closing" });
    expect((await adminPost(`/businesses/${id}/erase`, { reason: "Cleanup", confirmName: "Doomed" })).status).toBe(400);
    expect((await get("/products", safe)).status).toBe(200);
  });

  it("erases it for good: every row of that business is gone, another business is untouched, the record stays", async () => {
    const safeBefore = await rowsFor(safe.businessId);
    expect(Object.keys(await rowsFor(doomed.businessId)).length).toBeGreaterThan(5);
    const r = await adminPost(`/businesses/${doomed.businessPublicId}/erase`, { reason: "Customer left", confirmName: "Doomed Shop" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.rowsRemoved).toBeGreaterThan(5);

    expect(await rowsFor(doomed.businessId)).toEqual({});
    const gone = await query<{ n: number }>(`select count(*)::int as n from businesses where id = $1`, [doomed.businessId]);
    expect(gone[0]!.n).toBe(0);
    expect(await rowsFor(safe.businessId)).toEqual(safeBefore);
    expect((await get("/products", safe)).status).toBe(200);

    const owner = await query<{ n: number }>(`select count(*)::int as n from users where email = $1`, [doomed.email]);
    expect(owner[0]!.n).toBe(0); // an account that belonged only to this business is removed too
    // An employee also owns a personal workspace of their own, so their account stays with it (reported, not silently dropped).
    expect(r.body.data.accountsKept).toBe(1);

    const log = await query<{ action: string; details: any }>(`select action, details from platform_audit_logs where action = 'business.erase'`);
    expect(log).toHaveLength(1);
    expect(log[0]!.details.name).toBe("Doomed Shop");
    const actions = (await query<{ action: string }>(`select action from platform_audit_logs order by id`)).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["business.delete", "business.restore", "business.erase"]));
    expect((await overview()).deleted).toHaveLength(0);
  });

  it("an owner who also belongs to another business keeps their account", async () => {
    const a = await registerTenant("Erase Me Two");
    const aid = a.businessPublicId;
    // the same person is also a member of the safe shop
    const memberOfBoth = await query<{ id: string }>(`select id::text from users where email = $1`, [a.email]);
    const role = await query<{ id: string }>(`select id::text from roles where business_id = $1 limit 1`, [safe.businessId]);
    await query(`insert into business_users(business_id, user_id, role_id) values ($1, $2, $3)`, [safe.businessId, memberOfBoth[0]!.id, role[0]!.id]);
    await adminPost(`/businesses/${aid}/delete`, { reason: "Test" });
    const r = await adminPost(`/businesses/${aid}/erase`, { reason: "Test", confirmName: "Erase Me Two" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.accountsKept).toBe(1);
    const still = await query<{ n: number }>(`select count(*)::int as n from users where email = $1`, [a.email]);
    expect(still[0]!.n).toBe(1);
  });
});
