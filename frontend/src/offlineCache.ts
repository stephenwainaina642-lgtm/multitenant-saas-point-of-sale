/**
 * What the till needs to keep selling without internet, kept on this device only:
 * products with prices and this branch's stock, customer names and phone numbers, and the business's VAT settings.
 * It is refreshed every time the till loads online, and wiped when the user signs out.
 * No passwords, tokens or payment credentials are ever stored here.
 */
const PREFIX = "nexa_offline_cache_v1:";

export type OfflineCache<P, C> = {
  savedAt: number;
  products?: P[];
  customers?: C[];
  vat?: { registered: boolean; rate: string; inclusive: boolean; custom?: Record<string, string> };
};

const keyFor = (businessId: string, branchId: string | null) => `${PREFIX}${businessId}:${branchId ?? "main"}`;
const branchOf = (businessId: string) => {
  try { return sessionStorage.getItem(`pos_branch_${businessId}`); } catch { return null; }
};

export function readOfflineCache<P, C>(businessId: string): OfflineCache<P, C> | null {
  try {
    const raw = localStorage.getItem(keyFor(businessId, branchOf(businessId)));
    return raw ? (JSON.parse(raw) as OfflineCache<P, C>) : null;
  } catch {
    return null;
  }
}

/** Merge new pieces into the saved copy (products, customers and VAT arrive separately). */
export function saveOfflineCache<P, C>(businessId: string, part: Partial<Omit<OfflineCache<P, C>, "savedAt">>) {
  try {
    const key = keyFor(businessId, branchOf(businessId));
    const current = (JSON.parse(localStorage.getItem(key) ?? "null") as OfflineCache<P, C> | null) ?? { savedAt: 0 };
    localStorage.setItem(key, JSON.stringify({ ...current, ...part, savedAt: Date.now() }));
  } catch {
    /* storage full or blocked: the till still works online */
  }
}

/** Called on sign-out: customer details must not outlive the session on a shared device. */
export function clearOfflineCache() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(PREFIX)) localStorage.removeItem(k);
  } catch {
    /* nothing to clear */
  }
}
