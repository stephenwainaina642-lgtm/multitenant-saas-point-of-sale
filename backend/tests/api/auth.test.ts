import { describe, it, expect, beforeAll } from "vitest";
import { resetData } from "../support/db.js";
import { get, post } from "../support/http.js";
import { registerTenant, PASSWORD } from "../support/seed.js";

describe("authentication and business context", () => {
  beforeAll(resetData);

  it("registers an owner, creates the business and an owner membership", async () => {
    const t = await registerTenant("Auth Shop");
    const res = await get("/businesses/current", t);
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe("Auth Shop");
    expect(res.body.data.currency).toBe("KES");
    expect(res.body.data.timezone).toBe("Africa/Nairobi");
  });

  it("rejects duplicate registration for the same email", async () => {
    const t = await registerTenant("Dup Shop");
    const res = await post("/auth/register", undefined, {
      name: "x", email: t.email, password: PASSWORD, businessName: "Other",
    });
    expect(res.status).toBe(400);
  });

  it("rejects passwords shorter than 8 characters", async () => {
    const res = await post("/auth/register", undefined, {
      name: "x", email: "short@nexa-test.example", password: "abc", businessName: "B",
    });
    expect(res.status).toBe(400);
  });

  it("logs in with correct credentials and returns the user's businesses", async () => {
    const t = await registerTenant("Login Shop");
    const res = await post("/auth/login", undefined, { email: t.email, password: t.password });
    expect(res.status).toBe(200);
    expect(res.body.data.token).toBeTruthy();
    expect(res.body.data.businesses[0].role).toBe("owner");
  });

  it("rejects a wrong password with 401 and a generic message", async () => {
    const t = await registerTenant("Wrong Pw Shop");
    const res = await post("/auth/login", undefined, { email: t.email, password: "nope-nope-nope" });
    expect(res.status).toBe(401);
    expect(res.body.message).toBe("Invalid email or password");
  });

  it("requires a token, and rejects a malformed one", async () => {
    expect((await get("/products")).status).toBe(401);
    expect((await get("/products", { token: "not.a.jwt", businessId: "1" })).status).toBe(401);
  });

  it("requires the X-Business-ID header and a numeric id", async () => {
    const t = await registerTenant("Header Shop");
    expect((await get("/products", { token: t.token })).status).toBe(400);
    expect((await get("/products", { token: t.token, businessId: "abc" })).status).toBe(400);
  });

  // KD-10: register lowercases the email but login looks it up as typed.
  it.fails("KD-10 login accepts the email in a different letter case", async () => {
    const t = await registerTenant("Case Shop");
    const res = await post("/auth/login", undefined, {
      email: t.email.toUpperCase(), password: t.password,
    });
    expect(res.status).toBe(200);
  });
});
