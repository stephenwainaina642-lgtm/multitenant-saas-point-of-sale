/**
 * What a subscription means right now. Pure functions, no database: the same rules are used by the access check,
 * the Super Admin list and the business's own billing screen, so they can never disagree.
 *
 * Stored statuses are what the platform owner (or a confirmed payment) set. The EFFECTIVE status also looks at dates,
 * so a subscription that ran out moves to "grace" and then "expired" by itself, without a scheduler. Nothing is ever
 * deleted by any of this: a restricted business can still sign in and read and export its own data.
 */
export const SUB_STATUSES = ["trial", "pending_payment", "active", "past_due", "grace", "suspended", "cancelled", "expired"] as const;
export type SubStatus = (typeof SUB_STATUSES)[number];
export const BILLING_CYCLES = ["monthly", "annual", "one_time"] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

export const DEFAULT_GRACE_DAYS = 7;
const DAY = 86_400_000;

export type SubLike = { status: string; currentPeriodEnd: Date | null; graceDays: number };
export type Effective = {
  status: SubStatus;
  /** True when paid features are switched off (reading and exporting still work). */
  restricted: boolean;
  /** When the paid period ends (null = no end date). */
  periodEnd: Date | null;
  /** When grace ends and restriction starts (only while in grace). */
  graceEndsAt: Date | null;
  /** Whole days until the period ends (negative once past). Null when there is no end date. */
  daysLeft: number | null;
  /** Why it is restricted, in words the business owner can act on. */
  reason: string | null;
};

export function effectiveStatus(sub: SubLike | null | undefined, now = new Date()): Effective | null {
  if (!sub) return null; // legacy business: no subscription, never restricted
  const end = sub.currentPeriodEnd;
  const daysLeft = end ? Math.ceil((end.getTime() - now.getTime()) / DAY) : null;
  const base = { periodEnd: end, graceEndsAt: null as Date | null, daysLeft };
  const stored = (SUB_STATUSES as readonly string[]).includes(sub.status) ? (sub.status as SubStatus) : "expired";

  if (stored === "suspended") return { ...base, status: "suspended", restricted: true, reason: "This subscription is suspended. Contact nexaPOS support." };
  if (stored === "pending_payment") return { ...base, status: "pending_payment", restricted: true, reason: "Your subscription is waiting for its first payment." };
  if (stored === "expired") return { ...base, status: "expired", restricted: true, reason: "Your subscription has expired. Renew it to keep working." };

  // trial / active / past_due / grace / cancelled: look at the dates
  if (!end || now <= end) {
    // cancelled keeps working until the paid period ends
    return { ...base, status: stored === "grace" || stored === "past_due" ? "active" : stored, restricted: false, reason: null };
  }
  if (stored === "cancelled") return { ...base, status: "expired", restricted: true, reason: "Your subscription was cancelled and its paid period has ended." };
  const graceEndsAt = new Date(end.getTime() + sub.graceDays * DAY);
  if (now <= graceEndsAt) return { ...base, status: "grace", restricted: false, graceEndsAt, reason: null };
  return { ...base, status: "expired", restricted: true, reason: stored === "trial" ? "Your free trial has ended. Subscribe to keep working." : "Your subscription has expired. Renew it to keep working." };
}

/** Adds whole months the way a calendar does (31 Jan + 1 month = 28/29 Feb), in UTC. */
export function addMonths(from: Date, months: number): Date {
  const d = new Date(from.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

/** The end of the period after paying for `periods` cycles. Renewing early adds to the current end, never loses days. */
export function nextPeriodEnd(cycle: BillingCycle, currentEnd: Date | null, periods: number, now = new Date()): { from: Date; to: Date | null } {
  if (cycle === "one_time") return { from: now, to: null }; // a perpetual licence has no renewal date
  const from = currentEnd && currentEnd > now ? currentEnd : now;
  return { from, to: addMonths(from, (cycle === "annual" ? 12 : 1) * periods) };
}

/** Which methods of the request a restricted business may still use: reading and signing out. */
export function restrictedMayProceed(method: string, baseUrl: string): boolean {
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;
  return baseUrl === "/api/billing";
}
