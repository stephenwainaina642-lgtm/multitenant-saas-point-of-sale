/**
 * Where offline PIN sign-ins live on this PC (localStorage) and how they follow the signed-in session. No network and
 * no import of the API client, so the client can call `forgetOfflineUser` when the server says an account is gone.
 * The rules (hashing, lock after 5 wrong PINs) are in offlineSigninCore.ts.
 */
import { entryId, parseEntries, refreshEntry, type OfflineEntry, type OfflineSnapshot } from "./offlineSigninCore";

const STORE_KEY = "nexa_offline_signins_v1";

export function readEntries(): OfflineEntry[] {
  try {
    return parseEntries(localStorage.getItem(STORE_KEY));
  } catch {
    return [];
  }
}

function writeEntries(list: OfflineEntry[]) {
  try {
    if (list.length === 0) localStorage.removeItem(STORE_KEY);
    else localStorage.setItem(STORE_KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable or full: the PIN simply is not kept */
  }
}

export const getEntry = (id: string) => readEntries().find((e) => e.id === id) ?? null;

export function saveEntry(entry: OfflineEntry) {
  writeEntries([...readEntries().filter((e) => e.id !== entry.id), entry]);
}

/** Turn offline sign-in off for one person in one business on this PC. */
export function removeEntry(userId: string, businessId: string) {
  const id = entryId(userId, businessId);
  writeEntries(readEntries().filter((e) => e.id !== id));
}

/** Turn it off for a person everywhere on this PC (signing out, or the account was closed). */
export function forgetOfflineUser(userId: string | null | undefined) {
  if (!userId) return;
  writeEntries(readEntries().filter((e) => e.userId !== userId));
}

/** A real sign-in with the password proves who is at the keyboard, so wrong-PIN counts start again. */
export function resetLockoutFor(userId: string) {
  const list = readEntries();
  if (!list.some((e) => e.userId === userId && e.failed > 0)) return;
  writeEntries(list.map((e) => (e.userId === userId ? { ...e, failed: 0 } : e)));
}

const read = (key: string) => {
  try { return sessionStorage.getItem(key); } catch { return null; }
};
const readList = (key: string): string[] => {
  try {
    const raw = sessionStorage.getItem(key);
    const value = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
};

/** Who is signed in on this tab and what the server last said they may do. Null if the tab is not fully signed in. */
export function snapshotFromSession(): OfflineSnapshot | null {
  const userId = read("pos_user_id");
  const businessId = read("pos_business_id");
  const userName = read("pos_user_name");
  const businessName = read("pos_business_name");
  const role = read("pos_business_role");
  if (!userId || !businessId || !userName || !businessName || !role) return null;
  return { userId, userName, businessId, businessName, role, permissions: readList("pos_permissions"), modules: readList("pos_modules"), branchId: read(`pos_branch_${businessId}`) };
}

/**
 * Called after the till loads online. Keeps the saved name, role and permissions current, and removes the PIN
 * if this person may no longer use offline sign-in (their role was changed). The owner's role edit reaches the PC here.
 */
export function syncOfflineSignin() {
  const snap = snapshotFromSession();
  if (!snap) return;
  const existing = getEntry(entryId(snap.userId, snap.businessId));
  if (!existing) return;
  if (!snap.permissions.includes("offline.signin")) {
    removeEntry(snap.userId, snap.businessId);
    return;
  }
  saveEntry(refreshEntry(existing, snap));
}
