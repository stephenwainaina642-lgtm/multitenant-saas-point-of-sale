import { describe, it, expect, beforeAll } from "vitest";
import { resetData } from "../support/db.js";
import { api } from "../support/http.js";
import { addEmployee, registerTenant, type Tenant } from "../support/seed.js";

// The browser keeps one sign-in cookie for all tabs. A tab says who it thinks is signed in (X-Session-User);
// if the cookie now belongs to someone else the server refuses instead of acting as that other person.
describe("someone else signed in on this browser", () => {
  let owner: Tenant, cashier: Tenant;
  const as = (t: Tenant, claimed?: string) => api("GET", "/products", { session: t, ...(claimed !== undefined && { headers: { "x-session-user": claimed } }) });

  beforeAll(async () => {
    await resetData();
    owner = await registerTenant("Shared Till Shop");
    cashier = await addEmployee(owner, "cashier");
  }, 60_000);

  it("works when the tab names the person who is really signed in", async () => {
    expect((await as(owner, owner.userPublicId)).status).toBe(200);
    expect((await as(cashier, cashier.userPublicId)).status).toBe(200);
    expect((await as(owner, owner.userPublicId.toUpperCase())).status).toBe(200);
  });

  it("works for clients that send no header (scripts, tabs opened before this change)", async () => {
    expect((await as(owner)).status).toBe(200);
  });

  it("refuses when the sign-in belongs to someone else than the tab expects", async () => {
    // The owner's tab, but the browser's cookie is now the cashier's.
    const r = await as(cashier, owner.userPublicId);
    expect(r.status).toBe(401);
    expect(r.body.success).toBe(false);
    expect(r.body.message).toMatch(/someone else signed in/i);
    expect(r.body.data).toBeUndefined();
  });

  it("refuses the other way round too, and a made-up id", async () => {
    expect((await as(owner, cashier.userPublicId)).status).toBe(401);
    expect((await as(owner, "00000000-0000-4000-8000-000000000000")).status).toBe(401);
  });

  it("is checked on write routes as well", async () => {
    const r = await api("POST", "/employees/invites", { session: cashier, body: { name: "X Y", email: "x@y.example", roleName: "cashier" }, headers: { "x-session-user": owner.userPublicId } });
    expect(r.status).toBe(401);
  });
});
