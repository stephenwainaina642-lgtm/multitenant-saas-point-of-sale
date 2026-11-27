import { describe, it, expect, beforeAll } from "vitest";
import { resetData } from "../support/db.js";
import { api } from "../support/http.js";
import { addEmployee, registerTenant, type Tenant } from "../support/seed.js";
import { PERMISSION_CATALOG } from "../../src/auth/permissions.js";
import {
  attemptsLeft, checkPin, createEntry, entryId, isLocked, MAX_WRONG_PINS, parseEntries, pinProblem, refreshEntry,
  type OfflineSnapshot,
} from "../../../frontend/src/offlineSigninCore.js";

const snap: OfflineSnapshot = {
  userId: "u-1", userName: "Wanjiru Cashier", businessId: "b-1", businessName: "Chicken in Hotel",
  role: "Cashier", permissions: ["sales.create", "offline.signin"], modules: ["tables"], branchId: null,
};
const FAST = 1000; // iterations: the real value (210,000) is exercised once below

describe("PIN rules", () => {
  it("accepts 4 to 6 digits that are not obvious", () => {
    for (const ok of ["4827", "90153", "380216", "1357"]) expect(pinProblem(ok)).toBeNull();
  });
  it("refuses wrong length, non-digits, repeats and runs", () => {
    for (const bad of ["", "123", "1234567", "12a4", "1 34", "0000", "111111", "1234", "4321", "123456", "654321", "789"]) {
      expect(pinProblem(bad), `"${bad}" should be refused`).not.toBeNull();
    }
  });
});

describe("PIN check and lock", () => {
  it("stores a salted hash, never the PIN", async () => {
    const a = await createEntry(snap, "482716", FAST);
    const b = await createEntry(snap, "482716", FAST);
    expect(JSON.stringify(a)).not.toContain("482716");
    expect(a.salt).not.toBe(b.salt); // same PIN, different salt, different hash
    expect(a.hash).not.toBe(b.hash);
    expect(a.id).toBe(entryId("u-1", "b-1"));
  });

  it("opens with the right PIN and not with a wrong one", async () => {
    const e = await createEntry(snap, "482716", FAST);
    expect((await checkPin(e, "482716")).result).toBe("ok");
    const wrong = await checkPin(e, "482717");
    expect(wrong.result).toBe("wrong");
    expect(wrong.entry.failed).toBe(1);
  });

  it("locks after 5 wrong PINs and then refuses even the right one", async () => {
    let e = await createEntry(snap, "482716", FAST);
    for (let i = 1; i <= MAX_WRONG_PINS; i++) {
      const r = await checkPin(e, "000111");
      expect(r.result).toBe("wrong");
      e = r.entry;
      expect(attemptsLeft(e)).toBe(MAX_WRONG_PINS - i);
    }
    expect(isLocked(e)).toBe(true);
    const locked = await checkPin(e, "482716");
    expect(locked.result).toBe("locked");
    expect(locked.entry.failed).toBe(MAX_WRONG_PINS); // trying again changes nothing
  });

  it("a right PIN before the limit clears the wrong-PIN count", async () => {
    let e = await createEntry(snap, "482716", FAST);
    for (let i = 0; i < 4; i++) e = (await checkPin(e, "999000")).entry;
    expect(e.failed).toBe(4);
    const ok = await checkPin(e, "482716");
    expect(ok.result).toBe("ok");
    expect(ok.entry.failed).toBe(0);
  });

  it("works with the real iteration count", async () => {
    const e = await createEntry(snap, "482716");
    expect(e.iterations).toBe(210_000);
    expect((await checkPin(e, "482716")).result).toBe("ok");
    expect((await checkPin(e, "482715")).result).toBe("wrong");
  });

  it("a refresh from the server keeps the PIN and the lock count but updates the role and permissions", async () => {
    let e = await createEntry(snap, "482716", FAST);
    e = (await checkPin(e, "000111")).entry;
    const fresh = refreshEntry(e, { ...snap, role: "Senior Cashier", permissions: ["sales.create", "sales.void", "offline.signin"] });
    expect(fresh.role).toBe("Senior Cashier");
    expect(fresh.permissions).toContain("sales.void");
    expect(fresh.hash).toBe(e.hash);
    expect(fresh.failed).toBe(1);
    expect((await checkPin(fresh, "482716")).result).toBe("ok");
  });
});

describe("damaged storage", () => {
  it("reads nothing from junk and keeps only well-formed entries", async () => {
    const good = await createEntry(snap, "482716", FAST);
    expect(parseEntries(null)).toEqual([]);
    expect(parseEntries("not json")).toEqual([]);
    expect(parseEntries('{"a":1}')).toEqual([]);
    expect(parseEntries(JSON.stringify([null, 5, "x", { id: "only-id" }, { ...good, iterations: 1 }, good]))).toEqual([good]);
  });
});

describe("password confirmation (before a PIN is saved)", () => {
  let owner: Tenant;
  beforeAll(async () => { await resetData(); owner = await registerTenant("Pin Shop"); }, 60_000);

  it("is a permission the owner holds and a cashier does not by default", async () => {
    expect(PERMISSION_CATALOG).toHaveProperty("offline.signin");
    const cashier = await addEmployee(owner, "cashier");
    const roles = await api("GET", "/roles", { session: owner });
    const cashierRole = roles.body.data.find((r: { name: string }) => r.name.toLowerCase() === "cashier");
    expect(cashierRole.permissions).not.toContain("offline.signin");
    expect(cashier).toBeTruthy();
  });

  it("accepts the right password and changes nothing", async () => {
    const r = await api("POST", "/auth/confirm-password", { session: owner, body: { password: owner.password } });
    expect(r.status).toBe(200);
    expect((await api("GET", "/products", { session: owner })).status).toBe(200); // still signed in
  });

  it("refuses a wrong or missing password", async () => {
    expect((await api("POST", "/auth/confirm-password", { session: owner, body: { password: "not-the-password" } })).status).toBe(400);
    expect((await api("POST", "/auth/confirm-password", { session: owner, body: {} })).status).toBe(400);
    expect((await api("POST", "/auth/confirm-password", { session: owner, body: { password: "x".repeat(300) } })).status).toBe(400);
  });

  it("needs a signed-in user", async () => {
    expect((await api("POST", "/auth/confirm-password", { body: { password: owner.password } })).status).toBe(401);
  });

  it("an owner can give the permission to a role like any other", async () => {
    const roles = await api("GET", "/roles", { session: owner });
    const cashierRole = roles.body.data.find((r: { name: string }) => r.name.toLowerCase() === "cashier");
    const put = await api("PUT", `/roles/${cashierRole.id}`, { session: owner, body: { permissions: [...cashierRole.permissions, "offline.signin"] } });
    expect(put.status).toBe(200);
    expect(put.body.data.permissions).toContain("offline.signin");
  });
});
