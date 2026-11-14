import { describe, it, expect, beforeAll } from "vitest";
import { query, resetData } from "../support/db.js";
import { get, post, put } from "../support/http.js";
import { addEmployee, registerTenant, seedPhoneShop, type Tenant } from "../support/seed.js";

const login = (email: string, password: string) => post("/auth/login", undefined, { email, password });

describe("employees", () => {
  let s: Awaited<ReturnType<typeof seedPhoneShop>>;
  let other: Tenant;
  beforeAll(async () => {
    await resetData();
    s = await seedPhoneShop();
    other = await registerTenant("Other Shop");
  });

  const rolesOf = async (t: Tenant) => (await get("/roles", t)).body.data as { id: string; name: string }[];
  const mkRole = async (name: string, permissions: string[]) =>
    (await post("/roles", s.t, { name, permissions })).body.data.id as string;

  it("owner adds a new employee, who can log in with the temporary password and works within their role", async () => {
    const roleId = await mkRole("Till", ["sales.create", "products.view"]);
    const res = await post("/employees", s.t, { name: "Wanjiru", email: "Wanjiru@Shop.example", roleId });
    expect(res.status).toBe(201);
    expect(res.body.data.email).toBe("wanjiru@shop.example");
    const pw = res.body.temporaryPassword as string;
    expect(pw).toHaveLength(12);
    const [u] = await query(`select password_hash from users where email = 'wanjiru@shop.example'`);
    expect(u!.password_hash).not.toContain(pw);

    const l = await login("wanjiru@shop.example", pw);
    expect(l.status).toBe(200);
    expect(l.body.data.businesses.map((b: any) => b.id)).toContain(s.t.businessId);
    const emp = { token: l.body.data.token, businessId: s.t.businessId };
    expect((await get("/products", emp)).status).toBe(200);
    expect((await get("/expenses", emp)).status).toBe(403);
    expect((await get("/employees", emp)).status).toBe(403);
  });

  it("accepts an explicit password and then returns no temporary password", async () => {
    const roleId = await mkRole("Clerk", ["products.view"]);
    const res = await post("/employees", s.t, { name: "Kamau", email: "kamau@shop.example", roleId, password: "Chosen-Pass-77" });
    expect(res.status).toBe(201);
    expect(res.body.temporaryPassword).toBeNull();
    expect((await login("kamau@shop.example", "Chosen-Pass-77")).status).toBe(200);
    expect((await post("/employees", s.t, { name: "X", email: "x1@shop.example", roleId, password: "short" })).status).toBe(400);
  });

  it("validates input: email, name, role, owner role, foreign role", async () => {
    const roleId = await mkRole("Validator", ["products.view"]);
    expect((await post("/employees", s.t, { name: "A", email: "nope", roleId })).status).toBe(400);
    expect((await post("/employees", s.t, { name: "", email: "a1@shop.example", roleId })).status).toBe(400);
    expect((await post("/employees", s.t, { name: "A", email: "a2@shop.example" })).status).toBe(400);
    expect((await post("/employees", s.t, { name: "A", email: "a3@shop.example", roleName: "owner" })).status).toBe(400);
    const ownerRole = (await query(`select id from roles where business_id = $1 and lower(name) = 'owner'`, [s.t.businessId]))[0];
    if (ownerRole) expect((await post("/employees", s.t, { name: "A", email: "a4@shop.example", roleId: String(ownerRole.id) })).status).toBe(400);
    const foreign = (await post("/roles", other, { name: "Foreign", permissions: ["products.view"] })).body.data.id;
    expect((await post("/employees", s.t, { name: "A", email: "a5@shop.example", roleId: foreign })).status).toBe(400);
  });

  it("a built-in role name creates that role for the business on demand", async () => {
    const res = await post("/employees", s.t, { name: "Achieng", email: "achieng@shop.example", roleName: "cashier" });
    expect(res.status).toBe(201);
    expect(res.body.data.role.name).toBe("Cashier");
    const l = await login("achieng@shop.example", res.body.temporaryPassword);
    const emp = { token: l.body.data.token, businessId: s.t.businessId };
    expect((await get("/products", emp)).status).toBe(200);
  });

  it("adding an existing user from another business grants access without touching their account", async () => {
    const roleId = await mkRole("Visitor", ["products.view"]);
    const before = (await query(`select password_hash, name from users where id = $1`, [other.userId]))[0];
    const res = await post("/employees", s.t, { name: "Ignored Name", email: other.email, roleId });
    expect(res.status).toBe(201);
    expect(res.body.temporaryPassword).toBeNull();
    const after = (await query(`select password_hash, name from users where id = $1`, [other.userId]))[0];
    expect(after).toEqual(before);
    const added = res.body.data;
    expect((await post("/employees", s.t, { name: "x", email: other.email, roleId })).status).toBe(409);
    // profile and password of a multi-business user cannot be changed by this business
    expect((await put(`/employees/${added.id}`, s.t, { name: "Hacked" })).status).toBe(409);
    expect((await post(`/employees/${added.id}/reset-password`, s.t, {})).status).toBe(409);
    // role change is still fine
    const r2 = await mkRole("Visitor2", ["products.view", "customers.view"]);
    expect((await put(`/employees/${added.id}`, s.t, { roleId: r2 })).status).toBe(200);
  });

  it("deactivation takes effect immediately; reactivation restores access", async () => {
    const roleId = await mkRole("Temp", ["products.view"]);
    const add = await post("/employees", s.t, { name: "Temp", email: "temp@shop.example", roleId });
    const l = await login("temp@shop.example", add.body.temporaryPassword);
    const emp = { token: l.body.data.token, businessId: s.t.businessId };
    expect((await get("/products", emp)).status).toBe(200);
    expect((await post(`/employees/${add.body.data.id}/deactivate`, s.t, {})).status).toBe(200);
    expect((await get("/products", emp)).status).toBe(403);
    expect((await login("temp@shop.example", add.body.temporaryPassword)).body.data.businesses).toEqual([]);
    expect((await post(`/employees/${add.body.data.id}/activate`, s.t, {})).status).toBe(200);
    expect((await get("/products", emp)).status).toBe(200);
  });

  it("changing the role changes permissions on the next request", async () => {
    const low = await mkRole("Low", ["products.view"]);
    const high = await mkRole("High", ["products.view", "expenses.view"]);
    const add = await post("/employees", s.t, { name: "Role Change", email: "rc@shop.example", roleId: low });
    const l = await login("rc@shop.example", add.body.temporaryPassword);
    const emp = { token: l.body.data.token, businessId: s.t.businessId };
    expect((await get("/expenses", emp)).status).toBe(403);
    await put(`/employees/${add.body.data.id}`, s.t, { roleId: high });
    expect((await get("/expenses", emp)).status).toBe(200);
  });

  it("reset-password issues a new password and invalidates the old one", async () => {
    const roleId = await mkRole("Reset", ["products.view"]);
    const add = await post("/employees", s.t, { name: "Reset Me", email: "reset@shop.example", roleId });
    const r = await post(`/employees/${add.body.data.id}/reset-password`, s.t, {});
    expect(r.status).toBe(200);
    expect((await login("reset@shop.example", add.body.temporaryPassword)).status).toBe(401);
    expect((await login("reset@shop.example", r.body.temporaryPassword)).status).toBe(200);
  });

  it("protects the owner, yourself and other businesses", async () => {
    const list = (await get("/employees", s.t)).body.data as any[];
    const owner = list.find((e) => e.isOwner)!;
    expect(owner).toBeTruthy();
    expect((await post(`/employees/${owner.id}/deactivate`, s.t, {})).status).toBe(400);
    expect((await put(`/employees/${owner.id}`, s.t, { roleName: "cashier" })).status).toBe(400);
    expect((await post(`/employees/${owner.id}/reset-password`, s.t, {})).status).toBe(400);

    // a self-managing non-owner cannot deactivate or re-role themselves
    const adminRole = await mkRole("HR", ["employees.manage", "roles.manage"]);
    const add = await post("/employees", s.t, { name: "HR", email: "hr@shop.example", roleId: adminRole });
    const l = await login("hr@shop.example", add.body.temporaryPassword);
    const hr = { token: l.body.data.token, businessId: s.t.businessId };
    expect((await post(`/employees/${add.body.data.id}/deactivate`, hr, {})).status).toBe(400);
    expect((await put(`/employees/${add.body.data.id}`, hr, { roleName: "manager" })).status).toBe(400);
    // but HR can manage others, and cannot touch the owner
    expect((await post(`/employees/${owner.id}/deactivate`, hr, {})).status).toBe(400);

    // tenant isolation
    expect((await get("/employees", other)).body.data.map((e: any) => e.id)).not.toContain(add.body.data.id);
    expect((await post(`/employees/${add.body.data.id}/deactivate`, other, {})).status).toBe(404);
    expect((await put(`/employees/${add.body.data.id}`, other, { roleName: "cashier" })).status).toBe(404);
    expect((await post(`/employees/abc/deactivate`, s.t, {})).status).toBe(404);
  });

  it("permissions: manager and cashier cannot manage employees by default", async () => {
    const mgr = await addEmployee(s.t, "Manager");
    const csh = await addEmployee(s.t, "Cashier");
    expect((await get("/employees", mgr)).status).toBe(403);
    expect((await get("/employees", csh)).status).toBe(403);
    expect((await post("/employees", csh, { name: "x", email: "z@shop.example", roleName: "cashier" })).status).toBe(403);
  });

  it("audits additions, role changes, deactivation and password resets", async () => {
    const rows = await query(`select distinct action from audit_logs where business_id = $1 and entity = 'employee'`, [s.t.businessId]);
    const actions = rows.map((r) => r.action);
    for (const a of ["employee.add", "employee.update", "employee.deactivate", "employee.activate", "employee.reset_password"]) {
      expect(actions).toContain(a);
    }
  });
});
