import { describe, it, expect, beforeAll } from "vitest";
import { query, resetData } from "../support/db.js";
import { get, post, put } from "../support/http.js";
import { addEmployee, registerTenant, type Tenant } from "../support/seed.js";

describe("roles are plain data; only the owner is hardcoded", () => {
  let owner: Tenant, editor: Tenant;
  beforeAll(async () => {
    await resetData();
    owner = await registerTenant("Roles Shop");
    editor = await addEmployee(owner, "Role Editor", ["roles.manage", "employees.manage", "products.view"]);
  });

  it("a new business starts with editable starter roles holding explicit permissions", async () => {
    const roles = (await get("/roles", owner)).body.data as { name: string; permissions: string[] }[];
    const cashier = roles.find((r) => r.name === "Cashier");
    expect(cashier?.permissions).toContain("sales.create");
  });

  it("a role row with no permissions grants nothing, whatever its name", async () => {
    const empty = await addEmployee(owner, "Empty Role", []);
    expect((await get("/products", empty)).status).toBe(403);
  });

  it("changing a starter role changes what its holders can do", async () => {
    const cashierRole = ((await get("/roles", owner)).body.data as { id: string; name: string }[]).find((r) => r.name === "Cashier")!;
    const till = await addEmployee(owner, "Cashier");
    expect((await get("/products", till)).status).toBe(200);
    expect((await put(`/roles/${cashierRole.id}`, owner, { permissions: ["customers.view"] })).status).toBe(200);
    expect((await get("/products", till)).status).toBe(403);
  });

  it("an editor cannot grant what they do not hold, or edit their own role", async () => {
    const r = await post("/roles", editor, { name: "Sneaky", permissions: ["products.view", "settings.manage"] });
    expect(r.status).toBe(403);
    expect((await post("/roles", editor, { name: "Viewer2", permissions: ["products.view"] })).status).toBe(201);
    const mine = (await query<{ id: string }>(`select r.public_id::text as id from business_users bu join roles r on r.id = bu.role_id where bu.user_id = $1 and bu.business_id = $2`, [editor.userId, owner.businessId]))[0]!.id;
    expect((await put(`/roles/${mine}`, editor, { permissions: ["products.view", "settings.manage"] })).status).toBe(403);
    // owner may do both
    expect((await put(`/roles/${mine}`, owner, { permissions: ["roles.manage", "employees.manage", "products.view", "reports.view"] })).status).toBe(200);
  });

  it("an employee manager cannot hand out a role stronger than their own", async () => {
    const managerRole = ((await get("/roles", owner)).body.data as { id: string; name: string }[]).find((r) => r.name === "Accountant")!;
    const res = await post("/employees", editor, { name: "New Person", email: "np@roles.example", roleId: managerRole.id });
    expect(res.status).toBe(403);
  });
});
