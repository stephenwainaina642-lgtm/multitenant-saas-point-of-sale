import { describe, it, expect } from "vitest";
import { loadTestConfig } from "../support/env.js";

const base = loadTestConfig().apiBase;

describe("health endpoints", () => {
  it("liveness answers without auth", async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
  });

  it("readiness checks the database and needs no auth", async () => {
    const res = await fetch(`${base}/health/ready`);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(JSON.stringify(body)).not.toMatch(/postgres|password|DATABASE_URL/i);
  });
});
