import { describe, it, expect, beforeAll } from "vitest";
import bcrypt from "bcryptjs";
import { query, resetData } from "../support/db.js";
import { loadTestConfig } from "../support/env.js";
import { api, get, post } from "../support/http.js";
import { addEmployee, registerTenant, type Tenant } from "../support/seed.js";
import { encryptSecret, newTotpSecret, stepAt, totpAt } from "../../src/platform/totp.js";

process.env.JWT_SECRET = loadTestConfig().jwtSecret;
const PW = "Platform-Admin-Pass-1";

describe("packages: retail shop and hotel", () => {
  let admin = "";
  let shop: Tenant, hotel: Tenant, cafe: Tenant;
  const padmin = (method: string, path: string, body?: unknown) => api(method, `/platform${path}`, { session: { token: admin } as any, ...(body !== undefined && { body }) });
  const ctx = async (t: Tenant) => (await post("/business-context/select", t, { businessId: t.businessPublicId })).body.data;
  const names = async (t: Tenant) => ((await get("/roles", t)).body.data as { name: string }[]).map((r) => r.name);

  beforeAll(async () => {
    await resetData();
    const secret = newTotpSecret();
    await query(`insert into platform_admins(name, email, password_hash, totp_secret_enc) values ('Boss', 'boss@nexa.test', $1, $2)`, [await bcrypt.hash(PW, 4), encryptSecret(secret)]);
    const r = await api("POST", "/platform/login", { body: { email: "boss@nexa.test", password: PW, code: totpAt(secret, stepAt(Date.now())) } });
    admin = r.body.data.token;
    shop = await registerTenant("Pack Shop", "hardware");
    hotel = await registerTenant("Pack Hotel", "hotel");
    cafe = await registerTenant("Pack Cafe", "restaurant");
  }, 60_000);

  it("a new business starts with the package that fits its type", async () => {
    expect(await ctx(shop)).toMatchObject({ package: "retail", modules: ["purchasing", "documents"] });
    expect(await ctx(hotel)).toMatchObject({ package: "hotel", modules: ["tables", "rooms", "purchasing", "documents"] });
    expect(await ctx(cafe)).toMatchObject({ package: "hotel", modules: ["tables", "purchasing", "documents"] }); // restaurant: no rooms
  });

  it("a retail shop cannot reach hotel features at all (the server refuses, not just the menu)", async () => {
    for (const path of ["/hotel/tables", "/hotel/menu", "/hotel/settings", "/hotel/recipes", "/hotel/stays", "/hotel/stays/charge-targets"]) {
      const r = await get(path, shop);
      expect(r.status, path).toBe(403);
      expect(r.body.message, path).toMatch(/not included in this business's package/);
    }
    expect((await post("/hotel/tables", shop, { name: "T1" })).status).toBe(403);
    // Core features are untouched.
    for (const path of ["/products", "/customers", "/sales", "/suppliers", "/purchases", "/quotations", "/invoices"]) {
      expect((await get(path, shop)).status, path).toBe(200);
    }
  });

  it("a hotel has the hotel features, a restaurant has tables but no rooms", async () => {
    for (const path of ["/hotel/tables", "/hotel/menu", "/hotel/recipes", "/hotel/stays"]) expect((await get(path, hotel)).status, path).toBe(200);
    expect((await get("/hotel/tables", cafe)).status).toBe(200);
    expect((await get("/hotel/stays", cafe)).status).toBe(403);
    expect((await get("/hotel/stays/charge-targets", cafe)).status).toBe(403);
  });

  it("a business without Rooms cannot charge a bill to a room", async () => {
    const t = (await post("/hotel/tables", cafe, { name: "C1" })).body.data.id;
    const o = (await post(`/hotel/tables/${t}/orders`, cafe, {})).body.data.id;
    const r = await post(`/hotel/orders/${o}/bill`, cafe, { stayId: "00000000-0000-4000-8000-000000000000" });
    expect(r.status).toBe(403);
  });

  it("hotels get hotel starter roles; retail shops do not", async () => {
    const h = await names(hotel), s = await names(shop);
    for (const n of ["Waiter", "Receptionist", "Head Chef", "Cashier", "Manager"]) expect(h).toContain(n);
    expect(s).toContain("Cashier");
    for (const n of ["Waiter", "Receptionist", "Head Chef"]) expect(s).not.toContain(n);
    const recep = ((await get("/roles", hotel)).body.data as any[]).find((r) => r.name === "Receptionist");
    expect(recep.permissions).toEqual(expect.arrayContaining(["hotel.stays", "hotel.charge_room"]));
    const waiter = ((await get("/roles", hotel)).body.data as any[]).find((r) => r.name === "Waiter");
    expect(waiter.permissions).not.toContain("hotel.charge_room");
  });

  it("only platform admins can change packages; the overview shows each business's package and modules", async () => {
    const bizId = (await ctx(shop)).businessId as string;
    expect((await api("POST", `/platform/businesses/${bizId}/package`, { session: shop, body: { package: "hotel", reason: "sneaky" } })).status).toBe(401);
    expect((await api("POST", `/platform/businesses/${bizId}/modules`, { body: { modules: [], reason: "anon" } })).status).toBe(401);
    const o = (await padmin("GET", "/overview")).body.data.businesses as any[];
    const row = o.find((b) => b.id === bizId);
    expect(row.package).toBe("retail");
    expect(row.modules).toEqual(["purchasing", "documents"]);
    const info = (await padmin("GET", "/packages")).body.data;
    expect(Object.keys(info.packages)).toEqual(["retail", "hotel"]);
    expect(Object.keys(info.modules)).toEqual(["tables", "rooms", "purchasing", "documents"]);
  });

  it("switching a shop to the hotel package opens the hotel features at once, and is recorded with a reason", async () => {
    const bizId = (await ctx(shop)).businessId as string;
    expect((await padmin("POST", `/businesses/${bizId}/package`, { package: "hotel" })).status).toBe(400); // reason required
    expect((await padmin("POST", `/businesses/${bizId}/package`, { package: "casino", reason: "test reason" })).status).toBe(400);
    const r = await padmin("POST", `/businesses/${bizId}/package`, { package: "hotel", reason: "Client also runs a guest house" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.modules).toEqual(["tables", "rooms", "purchasing", "documents"]);
    expect((await get("/hotel/tables", shop)).status).toBe(200);
    expect(await ctx(shop)).toMatchObject({ package: "hotel" });
    const audit = (await padmin("GET", "/audit")).body.data as any[];
    const a = audit.find((x) => x.action === "business.package");
    expect(a.reason).toBe("Client also runs a guest house");
    expect(JSON.stringify(a.details)).toContain('"retail"');
    // and back: the hotel pages close again, existing shop data is untouched
    expect((await padmin("POST", `/businesses/${bizId}/package`, { package: "retail", reason: "Back to retail" })).status).toBe(200);
    expect((await get("/hotel/tables", shop)).status).toBe(403);
    expect((await get("/products", shop)).status).toBe(200);
  });

  it("modules can be switched on and off one by one; the data of a switched-off module is kept", async () => {
    const bizId = (await ctx(hotel)).businessId as string;
    // data created while the module was on
    const t = await post("/hotel/tables", hotel, { name: "Keep me" });
    expect(t.status).toBe(201);
    const off = await padmin("POST", `/businesses/${bizId}/modules`, { modules: ["tables", "documents"], reason: "Not buying rooms or purchasing" });
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    expect(off.body.data.modules).toEqual(["tables", "documents"]);
    expect((await get("/hotel/stays", hotel)).status).toBe(403);
    expect((await get("/suppliers", hotel)).status).toBe(403);
    expect((await get("/purchases", hotel)).status).toBe(403);
    expect((await get("/invoices", hotel)).status).toBe(200);
    expect((await get("/hotel/tables", hotel)).status).toBe(200);
    // switch back on: the earlier data is still there
    expect((await padmin("POST", `/businesses/${bizId}/modules`, { modules: ["rooms", "tables", "documents", "purchasing"], reason: "Bought the full set" })).status).toBe(200);
    const tables = (await get("/hotel/tables", hotel)).body.data as { name: string }[];
    expect(tables.some((x) => x.name === "Keep me")).toBe(true);
    expect((await get("/suppliers", hotel)).status).toBe(200);
    expect((await ctx(hotel)).modules).toEqual(["tables", "rooms", "purchasing", "documents"]); // canonical order
  });

  it("rejects bad module changes: unknown module, missing reason, no change", async () => {
    const bizId = (await ctx(hotel)).businessId as string;
    expect((await padmin("POST", `/businesses/${bizId}/modules`, { modules: ["tables", "spaceship"], reason: "test reason" })).status).toBe(400);
    expect((await padmin("POST", `/businesses/${bizId}/modules`, { modules: "tables", reason: "test reason" })).status).toBe(400);
    expect((await padmin("POST", `/businesses/${bizId}/modules`, { modules: ["tables"] })).status).toBe(400);
    expect((await padmin("POST", `/businesses/${bizId}/modules`, { modules: ["tables", "rooms", "purchasing", "documents"], reason: "no change" })).status).toBe(409);
    expect((await padmin("POST", `/businesses/00000000-0000-4000-8000-000000000000/modules`, { modules: [], reason: "test reason" })).status).toBe(404);
  });

  it("an employee with permissions still cannot use a switched-off module", async () => {
    const bizId = (await ctx(cafe)).businessId as string;
    const staff = await addEmployee(cafe, "front desk", ["hotel.stays", "hotel.charge_room", "sales.create", "products.view"]);
    expect((await get("/hotel/stays", staff)).status).toBe(403); // Rooms is off for the cafe
    expect((await padmin("POST", `/businesses/${bizId}/modules`, { modules: ["tables", "rooms"], reason: "Cafe added rooms" })).status).toBe(200);
    expect((await get("/hotel/stays", staff)).status).toBe(200);
  });

  it("the database refuses an unknown package or module", async () => {
    await expect(query(`update businesses set package = 'casino' where name = 'Pack Cafe'`)).rejects.toThrow(/businesses_package_valid/);
    await expect(query(`update businesses set modules = ARRAY['tables','spaceship'] where name = 'Pack Cafe'`)).rejects.toThrow(/businesses_modules_known/);
  });
});
