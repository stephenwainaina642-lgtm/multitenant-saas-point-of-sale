/**
 * The rules for signing in with a PIN on a PC that has no internet. Pure logic only (no storage, no network, no
 * imports) so a backend test can load it. `offlineSignin.ts` adds the storage and the screens' helpers around it.
 *
 * What is kept on the PC: a salted PBKDF2 hash of the PIN (never the PIN) plus the name, role and permission list the
 * server last gave this person. Nothing that works as a server session is kept: when the internet returns, sales sent
 * from a PIN session still need the person's real sign-in, and the server still checks every permission itself.
 */

export const PIN_MIN = 4;
export const PIN_MAX = 6;
export const MAX_WRONG_PINS = 5;
export const PBKDF2_ITERATIONS = 210_000;

export type OfflineEntry = {
  /** `${userId}:${businessId}`: one entry per person per business on this PC. */
  id: string;
  userId: string;
  userName: string;
  businessId: string;
  businessName: string;
  role: string;
  permissions: string[];
  modules: string[];
  branchId: string | null;
  salt: string;
  hash: string;
  iterations: number;
  /** Wrong PINs since the last sign-in with the real password. */
  failed: number;
  savedAt: number;
};

export type OfflineSnapshot = Pick<OfflineEntry, "userId" | "userName" | "businessId" | "businessName" | "role" | "permissions" | "modules" | "branchId">;

export const entryId = (userId: string, businessId: string) => `${userId}:${businessId}`;

/** A reason the PIN is not acceptable, or null. Short numbers are easy to guess, so the obvious ones are refused. */
export function pinProblem(pin: string): string | null {
  if (!new RegExp(`^\\d{${PIN_MIN},${PIN_MAX}}$`).test(pin)) return `The PIN must be ${PIN_MIN} to ${PIN_MAX} digits.`;
  if (/^(\d)\1+$/.test(pin)) return "That PIN is too easy to guess (all the same digit). Choose another.";
  const digits = [...pin].map(Number);
  const step = digits[1]! - digits[0]!;
  if ((step === 1 || step === -1) && digits.every((d, i) => i === 0 || d - digits[i - 1]! === step)) return "That PIN is too easy to guess (a run of numbers). Choose another.";
  return null;
}

const toB64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromB64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

export async function hashPin(pin: string, salt: string, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: fromB64(salt), iterations }, key, 256);
  return toB64(new Uint8Array(bits));
}

function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function createEntry(snapshot: OfflineSnapshot, pin: string, iterations = PBKDF2_ITERATIONS): Promise<OfflineEntry> {
  const problem = pinProblem(pin);
  if (problem) throw new Error(problem);
  const salt = toB64(crypto.getRandomValues(new Uint8Array(16)));
  return {
    ...snapshot,
    id: entryId(snapshot.userId, snapshot.businessId),
    salt,
    hash: await hashPin(pin, salt, iterations),
    iterations,
    failed: 0,
    savedAt: Date.now(),
  };
}

export const isLocked = (entry: OfflineEntry) => entry.failed >= MAX_WRONG_PINS;
export const attemptsLeft = (entry: OfflineEntry) => Math.max(0, MAX_WRONG_PINS - entry.failed);

export type PinCheck = { result: "ok" | "wrong" | "locked"; entry: OfflineEntry };

/**
 * Checks a PIN. A locked entry is not even tried (so waiting or reloading changes nothing); a wrong PIN counts toward
 * the lock; a right one clears the count. The returned entry is what to store.
 */
export async function checkPin(entry: OfflineEntry, pin: string): Promise<PinCheck> {
  if (isLocked(entry)) return { result: "locked", entry };
  const candidate = await hashPin(pin, entry.salt, entry.iterations).catch(() => "");
  if (candidate && sameText(candidate, entry.hash)) return { result: "ok", entry: { ...entry, failed: 0 } };
  return { result: "wrong", entry: { ...entry, failed: entry.failed + 1 } };
}

/** What the server last told us about this person, carried onto an existing entry. The PIN hash and the lock count stay. */
export function refreshEntry(entry: OfflineEntry, snapshot: OfflineSnapshot): OfflineEntry {
  return { ...entry, ...snapshot, savedAt: Date.now() };
}

/** Everything shaped like an entry, nothing else: damaged or tampered storage must not break the sign-in screen. */
export function parseEntries(raw: string | null): OfflineEntry[] {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return [];
    return list.filter((e): e is OfflineEntry => {
      if (typeof e !== "object" || e === null) return false;
      const x = e as Record<string, unknown>;
      return (
        typeof x.id === "string" && typeof x.userId === "string" && typeof x.businessId === "string" &&
        typeof x.userName === "string" && typeof x.businessName === "string" && typeof x.role === "string" &&
        Array.isArray(x.permissions) && Array.isArray(x.modules) &&
        typeof x.salt === "string" && typeof x.hash === "string" &&
        typeof x.iterations === "number" && x.iterations >= 1000 && typeof x.failed === "number"
      );
    });
  } catch {
    return [];
  }
}
