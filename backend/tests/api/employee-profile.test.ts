import { describe, it, expect, beforeAll } from "vitest";
import { resetData } from "../support/db.js";
import { get, post } from "../support/http.js";
import { addEmployee, createProduct, registerTenant, type Tenant } from "../support/seed.js";

describe("employee profile", () => {
  let owner: Tenant, other: Tenant, seller: Tenant, memberId: string;
  beforeAll(async () => {
    await resetData();
    owner = await registerTenant("Profile Shop");
    other = await registerTenant("Other Shop");
    seller = await addEmployee(owner, "Salesperson", ["sales.create", "sales.view_own", "products.view"]);
    const p = await createProduct(owner, { name: "Sugar", costPrice: 100, sellingPrice: 150, stockQuantity: 50 });
    for (let i = 0; i < 2; i++) {
      const r = await post("/sales", seller, { items: [{ productId: p.id, quantity: 2, unitPrice: 150 }], amountPaid: 300, paymentMethod: "cash" });
      expect(r.status).toBe(201);
    }
    const list = (await get("/employees", owner)).body.data as { id: string; userId: string }[];
    memberId = list.find((e) => e.userId === seller.userId)!.id;
  });

  it("shows details and that person's own sales figures", async () => {
    const r = await get(`/employees/${memberId}/profile`, owner);
    expect(r.status).toBe(200);
    expect(r.body.data.employee.role.name).toBe("Salesperson");
    expect(r.body.data.stats.salesCount).toBe(2);
    expect(r.body.data.stats.revenue).toBe(600);
    expect(r.body.data.recentSales).toHaveLength(2);
  });

  it("is manager-only and never crosses businesses", async () => {
    expect((await get(`/employees/${memberId}/profile`, seller)).status).toBe(403);
    expect((await get(`/employees/${memberId}/profile`, other)).status).toBe(404);
    expect((await get(`/employees/abc/profile`, owner)).status).toBe(404);
  });
});
