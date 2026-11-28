import { describe, it, expect, beforeAll } from "vitest";
import { resetData, query } from "../support/db.js";
import { api, get, post } from "../support/http.js";
import { deleteEmployee } from "../../src/employees/employee.service.js";
import { addEmployee, createProduct, registerTenant, type Tenant } from "../support/seed.js";

describe("owner deletes an employee", () => {
  let owner: Tenant, other: Tenant;
  beforeAll(async () => { await resetData(); owner = await registerTenant("Delete Shop"); other = await registerTenant("Other Delete Shop"); }, 60_000);

  const list = async (t: Tenant) => (await get("/employees", t)).body.data as { id: string; name: string; email: string; isOwner: boolean }[];
  const del = (t: Tenant, id: string) => api("DELETE", `/employees/${id}`, { session: t });

  it("removes access and the staff-list entry, keeps their sales and name, and keeps their account", async () => {
    const worker = await addEmployee(owner, "cashier");
    const product = await createProduct(owner, { name: "Soda", costPrice: 40, sellingPrice: 100, stockQuantity: 20 });
    const sale = await post("/sales", worker, { items: [{ productId: product.id, quantity: 1, unitPrice: 100 }], paymentMethod: "cash", amountPaid: 100 });
    expect(sale.status, JSON.stringify(sale.body)).toBe(201);
    const row = (await list(owner)).find((e) => e.email === worker.email)!;

    const r = await del(owner, row.id);
    expect(r.status, JSON.stringify(r.body)).toBe(200);

    expect((await list(owner)).some((e) => e.email === worker.email)).toBe(false);
    expect((await get("/products", worker)).status).toBe(403); // no longer let into the business
    const kept = await query<{ n: string }>(`select count(*)::text as n from sales where business_id = $1 and salesperson_id = (select id from users where email = $2)`, [owner.businessId, worker.email]);
    expect(kept[0]!.n).toBe("1"); // sales history stays
    const acct = await query<{ is_active: boolean }>(`select is_active from users where email = $1`, [worker.email]);
    expect(acct[0]!.is_active).toBe(true); // account stays, so adding them again works
    const logged = await query<{ n: string }>(`select count(*)::text as n from audit_logs where business_id = $1 and action = 'employee.delete'`, [owner.businessId]);
    expect(logged[0]!.n).toBe("1");
  });

  it("they can be added again afterwards", async () => {
    const worker = await addEmployee(owner, "cashier");
    const row = (await list(owner)).find((e) => e.email === worker.email)!;
    expect((await del(owner, row.id)).status).toBe(200);
    const again = await post("/employees", owner, { name: "Again", email: worker.email, roleName: "cashier" });
    expect(again.status, JSON.stringify(again.body)).toBe(201);
  });

  it("a cashier cannot delete anyone", async () => {
    const worker = await addEmployee(owner, "cashier");
    const row = (await list(owner)).find((e) => e.email === worker.email)!;
    expect((await del(worker, row.id)).status).toBe(403);
    expect((await list(owner)).some((e) => e.email === worker.email)).toBe(true);
  });

  it("even someone allowed to manage employees is refused unless they are the owner", async () => {
    const worker = await addEmployee(owner, "cashier");
    const row = (await list(owner)).find((e) => e.email === worker.email)!;
    // The route guard lets employees.manage through; the owner-only rule must still stop a non-owner.
    await expect(deleteEmployee(owner.businessId, row.id, { userId: 1n, permissions: new Set(["employees.manage"]), isOwner: false } as never))
      .rejects.toMatchObject({ status: 403, message: expect.stringMatching(/only the business owner/i) });
    expect((await list(owner)).some((e) => e.email === worker.email)).toBe(true);
  });

  it("the owner cannot be deleted, and nobody can delete themselves", async () => {
    const ownerRow = (await list(owner)).find((e) => e.isOwner)!;
    expect((await del(owner, ownerRow.id)).status).toBe(400);
  });

  it("is refused while the person has a till shift open", async () => {
    const worker = await addEmployee(owner, "cashier");
    const row = (await list(owner)).find((e) => e.email === worker.email)!;
    const shift = await post("/shifts/open", worker, { openingFloat: 100 });
    expect(shift.status, JSON.stringify(shift.body)).toBe(201);
    const r = await del(owner, row.id);
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/shift open/i);
    expect((await list(owner)).some((e) => e.email === worker.email)).toBe(true);
  });

  it("cannot touch another business's staff, and unknown or malformed ids are refused", async () => {
    const theirs = await addEmployee(other, "cashier");
    const theirRow = (await list(other)).find((e) => e.email === theirs.email)!;
    expect((await del(owner, theirRow.id)).status).toBe(404);
    expect((await list(other)).some((e) => e.email === theirs.email)).toBe(true);
    expect((await del(owner, "not-an-id")).status).toBe(400);
    expect((await del(owner, "00000000-0000-4000-8000-000000000000")).status).toBe(404);
  });
});
