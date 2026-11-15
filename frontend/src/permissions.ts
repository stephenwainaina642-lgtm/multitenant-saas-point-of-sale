/** The signed-in member's permissions for the current business (the server stays the real gatekeeper). */
const KEY = "pos_permissions";

export function storePermissions(list: string[] | undefined | null) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(list ?? []));
  } catch {
    /* storage unavailable */
  }
}

function held(): Set<string> | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? new Set<string>(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/** True if the member holds at least one of the permissions. Unknown (old session) shows everything; the server still refuses. */
export function can(...permissions: string[]): boolean {
  const set = held();
  if (!set) return true;
  return permissions.some((p) => set.has(p));
}
