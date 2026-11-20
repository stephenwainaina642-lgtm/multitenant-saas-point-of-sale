import { describe, it, expect, beforeAll } from "vitest";
import { resetData } from "../support/db.js";
import { post, put } from "../support/http.js";
import { registerTenant, type Tenant } from "../support/seed.js";

describe("input validation: phone numbers and names", () => {
  let owner: Tenant;
  beforeAll(async () => { await resetData(); owner = await registerTenant("Validation Shop"); });

  it("customers need a 10-digit phone and a clean name", async () => {
    const bad = async (body: object) => (await post("/customers", owner, body)).status;
    expect(await bad({ name: "Jane Wanjiru", phone: "07123" })).toBe(400);
    expect(await bad({ name: "Jane Wanjiru", phone: "+254712345678" })).toBe(400);
    expect(await bad({ name: "Jane Wanjiru", phone: "07123456ab" })).toBe(400);
    expect(await bad({ name: "Jane<script>", phone: "0712345678" })).toBe(400);
    expect(await bad({ name: "Jane 123", phone: "0712345678" })).toBe(400);
    const ok = await post("/customers", owner, { name: "Mary-Ann O'Neil Jr.", phone: "0712 345 678" });
    expect(ok.status).toBe(201);
    expect(ok.body.data.phone).toBe("0712345678");
    expect((await post("/customers", owner, { name: "No Phone" })).status).toBe(201);
  });

  it("editing a customer is validated too", async () => {
    const c = (await post("/customers", owner, { name: "Edit Me", phone: "0722000111" })).body.data;
    expect((await put(`/customers/${c.id}`, owner, { phone: "123" })).status).toBe(400);
    expect((await put(`/customers/${c.id}`, owner, { name: "Edit@Me" })).status).toBe(400);
    expect((await put(`/customers/${c.id}`, owner, { phone: "0722000999" })).status).toBe(200);
  });

  it("suppliers need a 10-digit phone; business names may hold digits and &", async () => {
    expect((await post("/suppliers", owner, { name: "Unga & Sons 2000 Ltd.", phone: "0733000111" })).status).toBe(201);
    expect((await post("/suppliers", owner, { name: "Unga", phone: "0733" })).status).toBe(400);
    expect((await post("/suppliers", owner, { name: "Bad<name>", phone: "0733000111" })).status).toBe(400);
  });

  it("employees need a clean name and a 10-digit phone", async () => {
    const add = async (b: object) => (await post("/employees", owner, { email: `e${Math.random().toString(36).slice(2)}@example.com`, roleName: "Cashier", ...b })).status;
    expect(await add({ name: "Peter Kamau", phone: "12345" })).toBe(400);
    expect(await add({ name: "Peter #1", phone: "0711000222" })).toBe(400);
    expect(await add({ name: "Peter Kamau", phone: "0711000222" })).toBe(201);
  });
});
