/**
 * Signing in with a PIN when the server cannot be reached. The PIN opens the till on this PC only; it is not a
 * session on the server. Sales made this way wait in the till's queue and are sent when the person's real sign-in
 * is valid again; if it is not, the till asks for the password first (see the 401 handling in api/client.ts).
 */
import { API_BASE_URL, SESSION_MARKER } from "./api/client";
import { checkPin, type OfflineEntry } from "./offlineSigninCore";
import { getEntry, saveEntry } from "./offlineSigninStore";

/** True if the server answers at all. `navigator.onLine` is not enough: a shop's Wi-Fi can be up while the internet is down. */
export async function serverReachable(timeoutMs = 4000): Promise<boolean> {
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), timeoutMs);
  try {
    await fetch(`${API_BASE_URL}/auth/signup-mode`, { signal: stop.signal, cache: "no-store" });
    return true; // any answer, even an error page, means the server is there
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export type PinSignIn = { result: "ok" | "wrong" | "locked" | "missing"; left: number };

/** Checks the PIN and, if right, fills the tab's session the way a normal sign-in does. */
export async function signInWithPin(id: string, pin: string): Promise<PinSignIn> {
  const entry = getEntry(id);
  if (!entry) return { result: "missing", left: 0 };
  const checked = await checkPin(entry, pin);
  saveEntry(checked.entry); // the wrong-PIN count must survive a reload
  if (checked.result !== "ok") return { result: checked.result, left: Math.max(0, 5 - checked.entry.failed) };
  applyEntryToSession(checked.entry);
  return { result: "ok", left: 5 };
}

function applyEntryToSession(entry: OfflineEntry) {
  sessionStorage.setItem("pos_token", SESSION_MARKER);
  sessionStorage.setItem("pos_business_id", entry.businessId);
  sessionStorage.setItem("pos_business_name", entry.businessName);
  sessionStorage.setItem("pos_business_role", entry.role);
  sessionStorage.setItem("pos_user_name", entry.userName);
  sessionStorage.setItem("pos_user_id", entry.userId);
  sessionStorage.setItem("pos_permissions", JSON.stringify(entry.permissions));
  sessionStorage.setItem("pos_modules", JSON.stringify(entry.modules));
  if (entry.branchId) sessionStorage.setItem(`pos_branch_${entry.businessId}`, entry.branchId);
  sessionStorage.setItem("pos_offline_session", "1");
}
