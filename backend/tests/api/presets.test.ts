import { describe, it, expect, beforeAll } from "vitest";
import { resetData } from "../support/db.js";
import { get, post, put } from "../support/http.js";
import { addEmployee, registerTenant, PASSWORD } from "../support/seed.js";
import { BUSINESS_PRESETS, BUSINESS_TYPES } from "../../src/lib/business-presets.js";

describe("business types and starter presets", () => {
  beforeAll(async () => { await resetData(); });

  it("every business type can register, and unknown types are rejected", async () => {
    for (const type of BUSINESS_TYPES) {
      const t = await registerTenant(`Type ${type}`, type);
      expect(t.token, type).toBeTruthy();
    }
    const bad = await post("/auth/register", undefined, {
      name: "X", email: "bad-type@nexa-test.example", password: PASSWORD, businessName: "Bad", businessType: "spaceship",
    });
    expect(bad.status).toBe(400);
  });

  it("every preset is well formed", () => {
    for (const [type, p] of Object.entries(BUSINESS_PRESETS)) {
      const names = p.categories.map((c) => c.toLowerCase());
      expect(new Set(names).size, type).toBe(names.length);
      expect(p.categories.every((c) => c.length > 0 && c.length <= 150), type).toBe(true);
      expect(p.units.length, type).toBeGreaterThan(0);
    }
  });

  it("previews, applies once, never duplicates, and keeps the owner's own categories", async () => {
    const t = await registerTenant("Hardware Co", "hardware");
    const mine = await post("/categories", t, { name: "plumbing" }); // clashes (case-insensitively) with a preset entry
    expect(mine.status).toBe(201);

    const preview = await get("/categories/starter", t);
    expect(preview.body.data.businessType).toBe("hardware");
    expect(preview.body.data.categories.find((c: any) => c.name === "Plumbing").exists).toBe(true);
    expect((await get("/categories", t)).body.data).toHaveLength(1); // preview changed nothing

    const first = await post("/categories/starter", t, {});
    expect(first.status).toBe(201);
    expect(first.body.data.skipped).toBe(1);
    expect(first.body.data.added).not.toContain("Plumbing");
    const names = (await get("/categories", t)).body.data.map((c: any) => c.name);
    expect(names).toContain("plumbing");
    expect(names).not.toContain("Plumbing");
    expect(names).toHaveLength(BUSINESS_PRESETS.hardware!.categories.length);

    const second = await post("/categories/starter", t, {});
    expect(second.body.data.added).toEqual([]);
    expect((await get("/categories", t)).body.data).toHaveLength(names.length);
  });

  it("is isolated per business and permission-checked", async () => {
    const a = await registerTenant("Timber Yard", "timber");
    const b = await registerTenant("Salon One", "salon");
    await post("/categories/starter", a, {});
    expect((await get("/categories", b)).body.data).toEqual([]);
    const viewer = await addEmployee(a, "Viewer2", ["products.view"]);
    expect((await get("/categories/starter", viewer)).status).toBe(200);
    expect((await post("/categories/starter", viewer, {})).status).toBe(403);
  });

  it("an unrecognised stored type falls back to the generic preset", async () => {
    const t = await registerTenant("Odd", "retail");
    expect((await put("/businesses/current", t, { businessType: "legacy_value" })).status).toBe(200);
    const preview = await get("/categories/starter", t);
    expect(preview.status).toBe(200);
    expect(preview.body.data.categories.map((c: any) => c.name)).toEqual(["General"]);
  });
});
