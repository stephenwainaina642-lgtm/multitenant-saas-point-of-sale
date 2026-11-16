import { describe, it, expect, beforeAll } from "vitest";
import { query, resetData } from "../support/db.js";
import { get, put } from "../support/http.js";
import { addEmployee, registerTenant } from "../support/seed.js";

describe("business profile: KRA PIN and time zone", () => {
  beforeAll(resetData);

  it("stores the KRA PIN normalised, shows it on the profile, and lets it be cleared", async () => {
    const t = await registerTenant("Pin Shop");
    expect((await get("/businesses/current", t)).body.data.taxPin).toBeNull();
    const r = await put("/businesses/current", t, { taxPin: " a001234567z " });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.taxPin).toBe("A001234567Z");
    expect((await get("/businesses/current", t)).body.data.taxPin).toBe("A001234567Z");
    expect((await put("/businesses/current", t, { taxPin: "" })).body.data.taxPin).toBeNull();
    expect((await put("/businesses/current", t, { taxPin: null })).status).toBe(200);
  });

  it("rejects malformed PINs and invalid time zones, and the database refuses them too", async () => {
    const t = await registerTenant("Bad Pin Shop");
    for (const taxPin of ["12345", "A00123456Z", "A0012345678Z", "AA01234567Z", "A001234567", 7]) {
      expect((await put("/businesses/current", t, { taxPin })).status, String(taxPin)).toBe(400);
    }
    expect((await put("/businesses/current", t, { timezone: "Mars/Olympus" })).status).toBe(400);
    expect((await put("/businesses/current", t, { timezone: "Europe/London" })).status).toBe(200);
    await expect(query(`update businesses set tax_pin = 'bad' where id = $1`, [t.businessId])).rejects.toThrow(/tax_pin_format/);
  });

  it("only people who may change settings can set it; other businesses are untouched", async () => {
    const a = await registerTenant("Shop A");
    const b = await registerTenant("Shop B");
    const cashier = await addEmployee(a, "Cashier");
    expect((await put("/businesses/current", cashier, { taxPin: "P051234567Q" })).status).toBe(403);
    expect((await put("/businesses/current", a, { taxPin: "P051234567Q" })).status).toBe(200);
    expect((await get("/businesses/current", b)).body.data.taxPin).toBeNull();
  });
});
