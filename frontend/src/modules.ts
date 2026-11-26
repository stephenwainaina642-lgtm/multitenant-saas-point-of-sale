/** The optional modules (package features) switched on for the current business. The server is the real gatekeeper. */
const KEY = "pos_modules";

export function storeModules(list: string[] | undefined | null) {
  try {
    if (list) sessionStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable */
  }
}

/** True if the module is on. Unknown (old session) shows everything; the server still refuses. */
export function hasModule(name: string): boolean {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as string[]).includes(name) : true;
  } catch {
    return true;
  }
}
