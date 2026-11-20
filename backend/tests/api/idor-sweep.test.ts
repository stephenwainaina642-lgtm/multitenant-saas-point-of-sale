import { describe, it, expect, beforeAll } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { query, resetData } from "../support/db.js";
import { api, get, post } from "../support/http.js";
import { createCustomer, createProduct, createSupplier, registerTenant, type Tenant } from "../support/seed.js";

/**
 * Cross-business sweep. Business A owns one of everything. Business B (a full owner of its own
 * business, so permissions are NOT what stops it) tries every route that takes an id, and every
 * route that accepts another record's id in its body, using A's ids. Nothing may succeed and
 * nothing of A's may change.
 */
describe("cross-business access sweep", () => {
  let A: Tenant, B: Tenant;
  const id: Record<string, string> = {};
  const line = (productId: string, quantity = 1, unitPrice = 100) => ({ productId, quantity, unitPrice });

  async function snapshotA() {
    const q = (sql: string) => query(sql, [A.businessId]).then((r) => JSON.stringify(r));
    return [
      await q(`select id,name,selling_price,stock_quantity,is_active,category_id from products where business_id = $1 order by id`),
      await q(`select id,name,phone,balance,is_active from customers where business_id = $1 order by id`),
      await q(`select id,name,is_active from suppliers where business_id = $1 order by id`),
      await q(`select id,name from categories where business_id = $1 order by id`),
      await q(`select id,status,total,amount_paid,balance_due,customer_id,notes from sales where business_id = $1 order by id`),
      await q(`select id,status,total,amount_paid from purchases where business_id = $1 order by id`),
      await q(`select id,category,amount from expenses where business_id = $1 order by id`),
      await q(`select id,status,notes from quotations where business_id = $1 order by id`),
      await q(`select id,name,permissions from roles where business_id = $1 order by id`),
      await q(`select id,user_id,role_id,is_active,branch_id from business_users where business_id = $1 order by id`),
      await q(`select id,name,is_active from branches where business_id = $1 order by id`),
      await q(`select id,status,manager_note from register_shifts where business_id = $1 order by id`),
      await q(`select branch_id,product_id,quantity from branch_stock where business_id = $1 order by branch_id,product_id`),
      await q(`select count(*) from payments where business_id = $1`),
      await q(`select count(*) from inventory_movements where business_id = $1`),
    ].join("|");
  }

  beforeAll(async () => {
    await resetData();
    A = await registerTenant("Sweep A");
    B = await registerTenant("Sweep B");
    const cat = await post("/categories", A, { name: "Drinks" });
    id.category = cat.body.data.id;
    const prod = await createProduct(A, { name: "Soda", costPrice: 40, sellingPrice: 100, stockQuantity: 50 });
    id.product = prod.id;
    id.customer = (await createCustomer(A, "Wanjiku")).id;
    id.supplier = (await createSupplier(A, "Bidco")).id;
    const sale = await post("/sales", A, { customerId: id.customer, items: [line(id.product, 2)], paymentMethod: "cash", amountPaid: 50 });
    expect(sale.status, JSON.stringify(sale.body)).toBe(201);
    id.sale = sale.body.data.id;
    const purchase = await post("/purchases", A, { supplierId: id.supplier, items: [{ productId: id.product, quantity: 5, unitCost: 40 }] });
    expect(purchase.status, JSON.stringify(purchase.body)).toBe(201);
    id.purchase = purchase.body.data.id;
    id.expense = (await post("/expenses", A, { category: "rent", amount: 500 })).body.data.id;
    const quote = await post("/quotations", A, { customerId: id.customer, items: [line(id.product, 1)] });
    expect(quote.status, JSON.stringify(quote.body)).toBe(201);
    id.quotation = quote.body.data.id;
    const inv = await post("/invoices", A, { saleId: id.sale });
    expect(inv.status, JSON.stringify(inv.body)).toBe(201);
    id.invoice = inv.body.data.id;
    id.role = (await post("/roles", A, { name: "Clerk", permissions: ["products.view"] })).body.data.id;
    const emp = await post("/employees", A, { name: "Worker", email: "worker@sweep-a.example", roleId: id.role });
    expect(emp.status, JSON.stringify(emp.body)).toBe(201);
    id.employee = emp.body.data.id;
    id.employeeUser = emp.body.data.userId ?? emp.body.data.id;
    const branches = (await get("/branches", A)).body.data;
    id.mainBranch = branches.find((b: any) => b.isMain).id;
    id.branch = (await post("/branches", A, { name: "Second" })).body.data.id;
    const shift = await post("/shifts/open", A, { openingFloat: 100 });
    expect(shift.status, JSON.stringify(shift.body)).toBe(201);
    id.shift = shift.body.data.id;
  }, 90_000);

  // [method, path template, body]. {x} is replaced with A's id of that kind.
  const attempts: [string, string, unknown?][] = [
    ["PUT", "/categories/{category}", { name: "Hacked" }],
    ["DELETE", "/categories/{category}"],
    ["PUT", "/products/{product}", { name: "Hacked", sellingPrice: 1 }],
    ["DELETE", "/products/{product}"],
    ["PUT", "/customers/{customer}", { name: "Hacked" }],
    ["DELETE", "/customers/{customer}"],
    ["GET", "/customers/{customer}/unpaid-sales"],
    ["POST", "/customers/{customer}/payments", { amount: 10, method: "cash" }],
    ["PUT", "/suppliers/{supplier}", { name: "Hacked" }],
    ["DELETE", "/suppliers/{supplier}"],
    ["GET", "/sales/{sale}"],
    ["PUT", "/sales/{sale}", { items: [line("{product}", 1)], notes: "Hacked" }],
    ["POST", "/sales/{sale}/void", { reason: "hack", refundMethod: "cash" }],
    ["POST", "/payments", { saleId: "{sale}", amount: 10, method: "cash" }],
    ["GET", "/purchases/{purchase}"],
    ["POST", "/purchases/{purchase}/payments", { amount: 10, method: "cash" }],
    ["POST", "/purchases/{purchase}/void", { reason: "hack" }],
    ["GET", "/expenses/{expense}"],
    ["PUT", "/expenses/{expense}", { amount: 1 }],
    ["DELETE", "/expenses/{expense}", { reason: "hack" }],
    ["GET", "/quotations/{quotation}"],
    ["PUT", "/quotations/{quotation}", { notes: "Hacked", items: [line("{product}", 1)] }],
    ["POST", "/quotations/{quotation}/status", { status: "accepted" }],
    ["POST", "/quotations/{quotation}/convert", {}],
    ["GET", "/invoices/{invoice}"],
    ["PUT", "/roles/{role}", { name: "Hacked", permissions: [] }],
    ["DELETE", "/roles/{role}"],
    ["GET", "/employees/{employee}/profile"],
    ["PUT", "/employees/{employee}", { name: "Hacked" }],
    ["POST", "/employees/{employee}/deactivate", {}],
    ["POST", "/employees/{employee}/activate", {}],
    ["POST", "/employees/{employee}/reset-password", {}],
    ["PUT", "/branches/{branch}", { name: "Hacked", isActive: false }],
    ["PATCH", "/branches/{branch}", { name: "Hacked" }],
    ["PUT", "/branches/staff/{employeeUser}", { branchId: "{branch}" }],
    ["GET", "/shifts/{shift}"],
    ["POST", "/shifts/{shift}/close", { countedCash: 0 }],
    ["POST", "/shifts/{shift}/note", { note: "Hacked" }],
    // ids carried in the body of B's own requests
    ["POST", "/sales", { customerId: "{customer}", items: [line("{product}", 1)], paymentMethod: "cash", amountPaid: 100 }],
    ["POST", "/purchases", { supplierId: "{supplier}", items: [{ productId: "{product}", quantity: 1, unitCost: 1 }] }],
    ["POST", "/products", { name: "Mine", costPrice: 1, sellingPrice: 2, categoryId: "{category}" }],
    ["POST", "/inventory", { productId: "{product}", type: "ADJUSTMENT", quantity: 999 }],
    ["POST", "/invoices", { saleId: "{sale}" }],
    ["POST", "/quotations", { customerId: "{customer}", items: [line("{product}", 1)] }],
    ["POST", "/employees", { name: "Sneak", email: "sneak@sweep-b.example", roleId: "{role}" }],
    ["POST", "/branches/transfers", { fromBranchId: "{mainBranch}", toBranchId: "{branch}", items: [{ productId: "{product}", quantity: 1 }] }],
    ["POST", "/shifts/open", { openingFloat: 1 }], // legitimate for B; must only ever touch B's own branch
  ];
  const fill = (v: unknown): unknown =>
    typeof v === "string" ? v.replace(/\{(\w+)\}/g, (_, k) => id[k]!) :
    Array.isArray(v) ? v.map(fill) :
    v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x)])) : v;

  it("business B can neither read nor change anything of business A's through any route", async () => {
    const before = await snapshotA();
    const problems: string[] = [];
    for (const [method, path, body] of attempts) {
      const r = await api(method, fill(path) as string, { session: B, body: body === undefined ? undefined : fill(body) });
      const legit = path === "/shifts/open"; // B opening its own till is allowed
      // It must be "not found / not yours" (404, 403, or 400 "... not found in this business"), not a validation error
      // (400) that could hide a missing ownership check behind a badly shaped request.
      const refusedAsForeign = [403, 404].includes(r.status) || (r.status === 400 && /not found/i.test(String(r.body?.message)));
      if (!legit && !refusedAsForeign) problems.push(`${method} ${path} -> ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
      if (legit && r.status >= 500) problems.push(`${method} ${path} -> ${r.status}`);
      // nothing from A may be echoed back in any response, even an error
      const echoed = JSON.stringify(r.body);
      for (const secret of ["Wanjiku", "Bidco", "worker@sweep-a.example", "Soda"]) {
        if (echoed.includes(secret)) problems.push(`${method} ${path} leaked "${secret}"`);
      }
    }
    expect(problems).toEqual([]);
    expect(await snapshotA()).toEqual(before);
  });

  it("B's own shift went into B's own branch, not A's", async () => {
    const rows = await query<{ business_id: string; branch_business: string }>(
      `select s.business_id::text, b.business_id::text as branch_business from register_shifts s join branches b on b.id = s.branch_id where s.business_id = $1`, [B.businessId]);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.branch_business).toBe(B.businessId);
  });

  it("B cannot choose A's branch with X-Branch-ID, nor use A's business with its own token", async () => {
    expect((await api("GET", "/branches", { session: B, headers: { "x-branch-id": String(id.branch) } })).status).toBe(403);
    expect((await api("GET", "/products", { session: { token: B.token, businessId: A.businessId } as any })).status).toBe(403);
    expect((await api("GET", "/branches/stock?current=1", { session: B, headers: { "x-branch-id": String(id.mainBranch) } })).status).toBe(403);
  });

  it("A's lists contain A's data while B's contain none of it (guards against a vacuous pass)", async () => {
    for (const p of ["/categories", "/products", "/customers", "/suppliers", "/sales", "/purchases", "/expenses", "/quotations", "/invoices", "/roles", "/employees", "/branches", "/shifts", "/inventory", "/branches/transfers", "/audit-logs"]) {
      const a = await get(p, A);
      const b = await get(p, B);
      expect(a.status, p).toBe(200);
      expect(b.status, p).toBeLessThan(500);
      const bText = JSON.stringify(b.body);
      for (const secret of ["Wanjiku", "Bidco", "worker@sweep-a.example", "Soda", "Sweep A"]) expect(bText, `${p} leaked ${secret}`).not.toContain(secret);
    }
  });

  it("every route that takes an id in its path is in this sweep (a new route must be added here)", () => {
    const covered = new Set(attempts.map(([m, p]) => `${m} ${p.replace(/\{\w+\}/g, ":id")}`));
    const mounts: Record<string, string> = {
      branches: "/branches", categories: "/categories", customers: "/customers", employees: "/employees",
      expenses: "/expenses", invoices: "/invoices", products: "/products", purchases: "/purchases",
      quotations: "/quotations", roles: "/roles", sales: "/sales", shifts: "/shifts", suppliers: "/suppliers",
    };
    const missing: string[] = [];
    for (const dir of readdirSync(join(__dirname, "../../src"), { withFileTypes: true })) {
      if (!dir.isDirectory() || !mounts[dir.name]) continue;
      for (const f of readdirSync(join(__dirname, "../../src", dir.name)).filter((x) => x.endsWith(".routes.ts"))) {
        const src = readFileSync(join(__dirname, "../../src", dir.name, f), "utf8");
        for (const m of src.matchAll(/router\.(get|post|put|patch|delete)\(\s*"([^"]*:[^"]*)"/g)) {
          const key = `${m[1]!.toUpperCase()} ${mounts[dir.name]}${m[2]!.replace(/:\w+/g, ":id")}`;
          if (!covered.has(key)) missing.push(key);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
