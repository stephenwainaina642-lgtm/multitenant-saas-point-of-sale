import { describe, it, expect, beforeAll } from "vitest";
import { query, resetData } from "../support/db.js";
import { del, get, post, put } from "../support/http.js";
import { addEmployee, registerTenant, type Tenant } from "../support/seed.js";

describe("categories", () => {
  let owner: Tenant;
  let other: Tenant;
  beforeAll(async () => { await resetData(); owner = await registerTenant("Cat Shop"); other = await registerTenant("Other Shop"); });

  const prod = (o: object = {}) => ({ name: "Item", costPrice: 10, sellingPrice: 20, ...o });

  it("creates, lists with product counts, renames and validates", async () => {
    const a = await post("/categories", owner, { name: "  Phones ", description: "Handsets" });
    expect(a.status).toBe(201);
    expect(a.body.data.name).toBe("Phones");
    expect((await post("/categories", owner, { name: "" })).status).toBe(400);
    expect((await post("/categories", owner, { name: "x".repeat(151) })).status).toBe(400);
    expect((await post("/categories", owner, { name: 5 })).status).toBe(400);
    // duplicates are rejected regardless of case, but allowed in another business
    expect((await post("/categories", owner, { name: "phones" })).status).toBe(409);
    expect((await post("/categories", other, { name: "Phones" })).status).toBe(201);

    const p = await post("/products", owner, prod({ name: "Galaxy", categoryId: a.body.data.id }));
    expect(p.status).toBe(201);
    expect(p.body.data.categoryId).toBe(a.body.data.id);
    const list = await get("/categories", owner);
    expect(list.body.data).toEqual([expect.objectContaining({ name: "Phones", productCount: 1 })]);
    const products = await get("/products", owner);
    expect(products.body.data[0].categoryName).toBe("Phones");

    const r = await put(`/categories/${a.body.data.id}`, owner, { name: "Mobile phones" });
    expect(r.status).toBe(200);
    expect(r.body.data.productCount).toBe(1);
    expect((await put(`/categories/${a.body.data.id}`, owner, {})).status).toBe(400);
    expect((await put(`/categories/${a.body.data.id}`, owner, { name: null })).status).toBe(400);
  });

  it("will not accept another business's category on a product, and cannot touch it directly", async () => {
    const theirs = (await post("/categories", other, { name: "Secret" })).body.data.id;
    expect((await post("/products", owner, prod({ name: "Bad", categoryId: theirs }))).status).toBe(400);
    const mine = await post("/products", owner, prod({ name: "Mine" }));
    expect((await put(`/products/${mine.body.data.id}`, owner, { categoryId: theirs })).status).toBe(400);
    expect((await put(`/categories/${theirs}`, owner, { name: "Hijack" })).status).toBe(404);
    expect((await del(`/categories/${theirs}`, owner)).status).toBe(404);
    expect((await get("/categories", owner)).body.data.map((c: any) => c.name)).not.toContain("Secret");
    expect((await post("/products", owner, prod({ name: "Junk", categoryId: "abc" }))).status).toBe(400);
  });

  it("moves products between categories, clears them, and protects a category in use", async () => {
    const c1 = (await post("/categories", owner, { name: "Chargers" })).body.data.id;
    const c2 = (await post("/categories", owner, { name: "Cables" })).body.data.id;
    const p = (await post("/products", owner, prod({ name: "USB-C", categoryId: c1 }))).body.data.id;

    const blocked = await del(`/categories/${c1}`, owner);
    expect(blocked.status).toBe(409);

    expect((await put(`/products/${p}`, owner, { categoryId: c2 })).body.data.categoryId).toBe(c2);
    expect((await put(`/products/${p}`, owner, { categoryId: null })).body.data.categoryId).toBeNull();
    expect((await del(`/categories/${c1}`, owner)).status).toBe(200);
    expect((await get("/categories", owner)).body.data.map((c: any) => c.name)).not.toContain("Chargers");
    const audit = await query(`select action from audit_logs where business_id=$1 and entity='category' order by id`, [owner.businessId]);
    expect(audit.map((r: any) => r.action)).toContain("category.delete");
  });

  it("follows permissions", async () => {
    const viewer = await addEmployee(owner, "Viewer", ["products.view"]);
    const nobody = await addEmployee(owner, "Nobody", []);
    expect((await get("/categories", viewer)).status).toBe(200);
    expect((await post("/categories", viewer, { name: "Nope" })).status).toBe(403);
    expect((await get("/categories", nobody)).status).toBe(403);
  });

  it("an archived product does not block deleting its category", async () => {
    const c = (await post("/categories", owner, { name: "Old" })).body.data.id;
    const p = (await post("/products", owner, prod({ name: "Gone", categoryId: c }))).body.data.id;
    await del(`/products/${p}`, owner);
    expect((await del(`/categories/${c}`, owner)).status).toBe(200);
  });
});
