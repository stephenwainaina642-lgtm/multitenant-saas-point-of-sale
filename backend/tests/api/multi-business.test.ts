import { describe, it, expect, beforeAll } from "vitest";
import { query, resetData } from "../support/db.js";
import { api, get, post } from "../support/http.js";
import { createProduct, registerTenant } from "../support/seed.js";

describe("an owner adds another business", () => {
  beforeAll(resetData);

  it("creates a separate business under the same login with its own data", async () => {
    const a = await registerTenant("Shop A");
    await createProduct(a, { name: "Only In A", costPrice: 10, sellingPrice: 20, stockQuantity: 5 });

    const made = await post("/businesses", a, { name: "Shop B", businessType: "pharmacy" });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect(made.body.data).toMatchObject({ name: "Shop B", businessType: "pharmacy", role: "owner" });
    const b = { ...a, businessId: made.body.data.id };

    const list = (await get("/businesses", a)).body.data.map((x: any) => x.name).sort();
    expect(list).toEqual(["Shop A", "Shop B"]);

    expect((await get("/products", b)).body.data.map((p: any) => p.name)).toEqual([]); // B starts empty
    expect((await get("/products", a)).body.data).toHaveLength(1);
    expect((await post("/business-context/select", a, { businessId: b.businessId })).status).toBe(200);
    expect((await get("/businesses/current", b)).body.data.name).toBe("Shop B");
    const [row] = await query(`select owner_user_id from businesses where name = 'Shop B'`);
    const [rowA] = await query(`select owner_user_id from businesses where name = 'Shop A'`);
    expect(row!.owner_user_id).toBe(rowA!.owner_user_id);
  });

  it("cannot reach a business it does not belong to, and validates the request", async () => {
    const x = await registerTenant("Other Owner");
    const y = await registerTenant("Someone Else");
    expect((await get("/products", { ...x, businessId: y.businessId })).status).toBe(403);
    expect((await post("/businesses", x, { name: "  " })).status).toBe(400);
    expect((await post("/businesses", x, { name: "Ok", businessType: "spaceship" })).status).toBe(400);
    expect((await api("POST", "/businesses", { body: { name: "No login" } })).status).toBe(401);
  });

  it("stops at 10 businesses per owner, even with simultaneous requests", async () => {
    const t = await registerTenant("Cap Owner");
    const results = await Promise.all(Array.from({ length: 14 }, (_, i) => post("/businesses", t, { name: `Branch ${i}` })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(9); // plus the one made at sign-up
    expect(results.filter((r) => r.status === 409)).toHaveLength(5);
    expect((await get("/businesses", t)).body.data).toHaveLength(10);
  });
});
