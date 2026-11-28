import type { Prisma } from "../generated/prisma/client.js";
import prisma from "../lib/prisma.js";
import { AppError } from "../lib/errors.js";
import { requirePublicId } from "../lib/public-id.js";
import { isModule, MODULES } from "../lib/packages.js";
import { BILLING_CYCLES, DEFAULT_GRACE_DAYS, effectiveStatus, nextPeriodEnd, type BillingCycle } from "../lib/subscription.js";

/**
 * The platform's commercial core: plans, one subscription per business, and manually recorded payments.
 *
 * Rules that matter:
 *  - A subscription becomes "active" only through an APPROVED payment, or an explicit complimentary grant by the
 *    platform owner. Opening a link or a browser redirect can never do it (there are none yet; provider payments
 *    come in a later phase and will go through the same approvePayment path).
 *  - Plan limits and prices are copied onto the subscription, so editing a plan never changes an existing customer.
 *  - Nothing here deletes business data. Restriction only blocks changes (see business.middleware).
 *  - Every privileged action writes a platform audit record and a subscription history event.
 */

const num = (d: unknown) => (d == null ? null : Number(d));
const round2 = (n: number) => Math.round(n * 100) / 100;

function cleanReason(reason: unknown): string {
  const r = typeof reason === "string" ? reason.trim() : "";
  if (r.length < 3) throw new AppError(400, "A reason (at least 3 characters) is required");
  if (r.length > 500) throw new AppError(400, "Reason is too long (500 characters at most)");
  return r;
}
function money(v: unknown, label: string, allowNull = false): number | null {
  if (v === null || v === undefined || v === "") {
    if (allowNull) return null;
    throw new AppError(400, `${label} is required`);
  }
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d+(\.\d{1,2})?$/.test(v.trim()) ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < 0 || n > 99_999_999) throw new AppError(400, `${label} must be an amount of 0 or more, with at most 2 decimals`);
  return round2(n);
}
function wholeNumber(v: unknown, label: string, min: number, max: number, allowNull: boolean): number | null {
  if (v === null || v === undefined || v === "") {
    if (allowNull) return null;
    throw new AppError(400, `${label} is required`);
  }
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new AppError(400, `${label} must be a whole number from ${min} to ${max}`);
  return n;
}
const text = (v: unknown, label: string, max: number, required = false): string | null => {
  const t = typeof v === "string" ? v.trim() : "";
  if (!t) {
    if (required) throw new AppError(400, `${label} is required`);
    return null;
  }
  if (t.length > max) throw new AppError(400, `${label} is too long (${max} characters at most)`);
  return t;
};

// ---------------------------------------------------------------- plans

type PlanRow = Awaited<ReturnType<typeof prisma.platformPlan.findFirstOrThrow>>;
function formatPlan(p: PlanRow, subscribers = 0) {
  return {
    id: p.publicId, code: p.code, name: p.name, description: p.description, currency: p.currency,
    monthlyPrice: num(p.monthlyPrice), annualPrice: num(p.annualPrice), oneTimePrice: num(p.oneTimePrice),
    installationFee: num(p.installationFee), trainingFee: num(p.trainingFee), discountPercent: num(p.discountPercent),
    trialDays: p.trialDays, graceDays: p.graceDays, maxBranches: p.maxBranches, maxEmployees: p.maxEmployees,
    modules: p.modules, isActive: p.isActive, archived: p.archivedAt !== null, subscribers,
  };
}

function planData(body: Record<string, unknown>, partial: boolean) {
  const d: Prisma.PlatformPlanUncheckedUpdateInput = {};
  const has = (k: string) => !partial || body[k] !== undefined;
  if (has("name")) d.name = text(body.name, "Plan name", 120, true)!;
  if (has("description")) d.description = text(body.description, "Description", 1000);
  if (has("monthlyPrice")) d.monthlyPrice = money(body.monthlyPrice, "Monthly price", true);
  if (has("annualPrice")) d.annualPrice = money(body.annualPrice, "Annual price", true);
  if (has("oneTimePrice")) d.oneTimePrice = money(body.oneTimePrice, "One-time licence price", true);
  if (has("installationFee")) d.installationFee = money(body.installationFee ?? 0, "Installation fee")!;
  if (has("trainingFee")) d.trainingFee = money(body.trainingFee ?? 0, "Training fee")!;
  if (has("discountPercent")) {
    const v = body.discountPercent === undefined || body.discountPercent === "" ? 0 : Number(body.discountPercent);
    if (!Number.isFinite(v) || v < 0 || v > 100) throw new AppError(400, "Discount must be from 0 to 100 percent");
    d.discountPercent = round2(v);
  }
  if (has("trialDays")) d.trialDays = wholeNumber(body.trialDays ?? 0, "Trial days", 0, 365, false)!;
  if (has("graceDays")) d.graceDays = wholeNumber(body.graceDays, "Grace days", 0, 90, true);
  if (has("maxBranches")) d.maxBranches = wholeNumber(body.maxBranches, "Branch limit", 1, 10_000, true);
  if (has("maxEmployees")) d.maxEmployees = wholeNumber(body.maxEmployees, "Staff limit", 1, 100_000, true);
  if (has("modules")) {
    if (body.modules === undefined) body.modules = [];
    if (!Array.isArray(body.modules) || !body.modules.every(isModule)) throw new AppError(400, `Modules must be chosen from: ${MODULES.join(", ")}`);
    d.modules = [...new Set(body.modules as string[])];
  }
  if (has("isActive") && body.isActive !== undefined) {
    if (typeof body.isActive !== "boolean") throw new AppError(400, "isActive must be true or false");
    d.isActive = body.isActive;
  }
  return d;
}

export async function listPlans() {
  const [plans, counts] = await Promise.all([
    prisma.platformPlan.findMany({ orderBy: [{ archivedAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }] }),
    prisma.platformSubscription.groupBy({ by: ["planId"], _count: { _all: true } }),
  ]);
  const by = new Map(counts.map((c) => [String(c.planId), c._count._all]));
  return plans.map((p) => formatPlan(p, by.get(String(p.id)) ?? 0));
}

export async function createPlan(adminId: bigint, body: Record<string, unknown>) {
  const name = text(body.name, "Plan name", 120, true)!;
  const code = (text(body.code, "Plan code", 40) ?? name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  if (!code) throw new AppError(400, "Plan code is required");
  const data = planData(body, false) as Prisma.PlatformPlanUncheckedCreateInput;
  try {
    const p = await prisma.$transaction(async (tx) => {
      const created = await tx.platformPlan.create({ data: { ...data, code, name } });
      await tx.platformAuditLog.create({ data: { adminId, action: "plan.create", reason: `Created plan ${name}`, details: { plan: created.publicId, code } } });
      return created;
    });
    return formatPlan(p);
  } catch (e) {
    if ((e as { code?: string })?.code === "P2002") throw new AppError(409, "A plan with that code already exists");
    throw e;
  }
}

async function planByPublicId(idText: string) {
  const publicId = requirePublicId(idText, "A valid plan ID is required");
  const p = await prisma.platformPlan.findUnique({ where: { publicId } });
  if (!p) throw new AppError(404, "Plan not found");
  return p;
}

export async function updatePlan(adminId: bigint, idText: string, body: Record<string, unknown>) {
  const plan = await planByPublicId(idText);
  const data = planData(body, true);
  const p = await prisma.$transaction(async (tx) => {
    const updated = await tx.platformPlan.update({ where: { id: plan.id }, data: { ...data, updatedAt: new Date() } });
    await tx.platformAuditLog.create({ data: { adminId, action: "plan.update", reason: `Edited plan ${plan.name}`, details: { plan: plan.publicId, changed: Object.keys(data) } } });
    return updated;
  });
  const n = await prisma.platformSubscription.count({ where: { planId: plan.id } });
  return formatPlan(p, n);
}

/** Archive (hide from new assignments, keep for the customers on it) or bring back. */
export async function archivePlan(adminId: bigint, idText: string, archive: boolean) {
  const plan = await planByPublicId(idText);
  const p = await prisma.$transaction(async (tx) => {
    const updated = await tx.platformPlan.update({ where: { id: plan.id }, data: { archivedAt: archive ? new Date() : null, isActive: archive ? false : true, updatedAt: new Date() } });
    await tx.platformAuditLog.create({ data: { adminId, action: archive ? "plan.archive" : "plan.unarchive", reason: `${archive ? "Archived" : "Restored"} plan ${plan.name}`, details: { plan: plan.publicId } } });
    return updated;
  });
  return formatPlan(p, await prisma.platformSubscription.count({ where: { planId: plan.id } }));
}

/** A plan that nobody ever used can be removed for good; one in use can only be archived. */
export async function deletePlan(adminId: bigint, idText: string) {
  const plan = await planByPublicId(idText);
  if (await prisma.platformSubscription.count({ where: { planId: plan.id } })) throw new AppError(409, "This plan is used by customers. Archive it instead of deleting it.");
  await prisma.$transaction([
    prisma.platformPlan.delete({ where: { id: plan.id } }),
    prisma.platformAuditLog.create({ data: { adminId, action: "plan.delete", reason: `Deleted unused plan ${plan.name}`, details: { plan: plan.publicId, code: plan.code } } }),
  ]);
}

// ---------------------------------------------------------------- subscriptions

async function businessOf(idText: string) {
  const publicId = requirePublicId(idText, "A valid business ID is required");
  const b = await prisma.business.findUnique({ where: { publicId }, select: { id: true, publicId: true, name: true, modules: true, deletedAt: true } });
  if (!b) throw new AppError(404, "Business not found");
  return b;
}

type SubRow = NonNullable<Awaited<ReturnType<typeof prisma.platformSubscription.findUnique>>>;
export function formatSubscription(s: SubRow, now = new Date()) {
  const eff = effectiveStatus(s, now)!;
  return {
    id: s.publicId, planName: s.planName,
    storedStatus: s.status, status: eff.status, restricted: eff.restricted, reason: eff.reason,
    billingCycle: s.billingCycle, agreedPrice: num(s.agreedPrice), currency: s.currency,
    startedAt: s.startedAt, trialEndsAt: s.trialEndsAt, currentPeriodEnd: s.currentPeriodEnd, graceEndsAt: eff.graceEndsAt,
    daysLeft: eff.daysLeft, graceDays: s.graceDays, maxBranches: s.maxBranches, maxEmployees: s.maxEmployees,
    cancelledAt: s.cancelledAt, notes: s.notes,
  };
}

async function usageOf(businessId: bigint) {
  const [employees, branches] = await Promise.all([
    prisma.businessUser.count({ where: { businessId, isActive: true } }),
    prisma.branch.count({ where: { businessId, isActive: true } }),
  ]);
  return { employees, branches };
}

function event(tx: Prisma.TransactionClient, businessId: bigint, adminId: bigint | null, name: string, from: string | null, to: string | null, details: Record<string, unknown>) {
  return tx.platformSubscriptionEvent.create({ data: { businessId, adminId, event: name, fromStatus: from, toStatus: to, details: details as Prisma.InputJsonValue } });
}

export async function listSubscriptions() {
  const subs = await prisma.platformSubscription.findMany({ include: { business: { select: { publicId: true, name: true, deletedAt: true } } }, orderBy: { updatedAt: "desc" } });
  const now = new Date();
  return subs.filter((s) => !s.business.deletedAt).map((s) => ({ businessId: s.business.publicId, businessName: s.business.name, ...formatSubscription(s, now) }));
}

export async function subscriptionDetail(businessIdText: string) {
  const b = await businessOf(businessIdText);
  const sub = await prisma.platformSubscription.findUnique({ where: { businessId: b.id } });
  const [payments, events, usage] = await Promise.all([
    prisma.platformPayment.findMany({ where: { businessId: b.id }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.platformSubscriptionEvent.findMany({ where: { businessId: b.id }, orderBy: { createdAt: "desc" }, take: 50 }),
    usageOf(b.id),
  ]);
  return {
    business: { id: b.publicId, name: b.name, modules: b.modules },
    subscription: sub ? formatSubscription(sub) : null,
    legacy: !sub,
    usage,
    payments: payments.map(formatPayment),
    history: events.map((e) => ({ at: e.createdAt, event: e.event, from: e.fromStatus, to: e.toStatus, details: e.details })),
  };
}

/**
 * Put a business on a plan. A new subscription must say how it starts (trial, waiting for its first payment, or a
 * complimentary grant). For one that already exists, the plan, price and limits change while its paid period and
 * status stay exactly as they are, so upgrading or downgrading never gives or takes away paid time.
 */
export async function assignPlan(adminId: bigint, businessIdText: string, body: Record<string, unknown>) {
  const reason = cleanReason(body.reason);
  const b = await businessOf(businessIdText);
  if (b.deletedAt) throw new AppError(409, "Restore this business before changing its plan");
  const plan = await planByPublicId(String(body.planId ?? ""));
  if (plan.archivedAt || !plan.isActive) throw new AppError(409, "That plan is archived or switched off");

  const cycle = String(body.billingCycle ?? "monthly") as BillingCycle;
  if (!(BILLING_CYCLES as readonly string[]).includes(cycle)) throw new AppError(400, "Billing cycle must be monthly, annual or one_time");
  const listPrice = cycle === "monthly" ? plan.monthlyPrice : cycle === "annual" ? plan.annualPrice : plan.oneTimePrice;
  const existing = await prisma.platformSubscription.findUnique({ where: { businessId: b.id } });

  const mode = existing ? "keep" : String(body.mode ?? "");
  if (!existing && !["trial", "pending", "complimentary"].includes(mode)) throw new AppError(400, "Choose how it starts: trial, pending payment or complimentary");

  let agreed: number;
  if (mode === "complimentary") agreed = 0;
  else if (body.agreedPrice !== undefined && body.agreedPrice !== null && body.agreedPrice !== "") agreed = money(body.agreedPrice, "Agreed price")!;
  else if (listPrice != null) agreed = round2(Number(listPrice) * (1 - Number(plan.discountPercent) / 100));
  else throw new AppError(400, `This plan has no ${cycle.replace("_", "-")} price. Set one on the plan or enter an agreed price.`);

  const graceDays = body.graceDays !== undefined && body.graceDays !== "" ? wholeNumber(body.graceDays, "Grace days", 0, 90, false)! : plan.graceDays ?? existing?.graceDays ?? DEFAULT_GRACE_DAYS;
  const maxBranches = body.maxBranches !== undefined ? wholeNumber(body.maxBranches, "Branch limit", 1, 10_000, true) : plan.maxBranches;
  const maxEmployees = body.maxEmployees !== undefined ? wholeNumber(body.maxEmployees, "Staff limit", 1, 100_000, true) : plan.maxEmployees;
  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {
    const common = { planId: plan.id, planName: plan.name, billingCycle: cycle, agreedPrice: agreed, currency: plan.currency, graceDays, maxBranches, maxEmployees };
    let sub: SubRow;
    let from: string | null = null;
    if (existing) {
      from = existing.status;
      sub = await tx.platformSubscription.update({ where: { id: existing.id }, data: { ...common, updatedAt: now } });
    } else {
      let status = "pending_payment";
      let end: Date | null = null;
      let trialEnds: Date | null = null;
      if (mode === "trial") {
        const days = body.trialDays !== undefined && body.trialDays !== "" ? wholeNumber(body.trialDays, "Trial days", 1, 365, false)! : plan.trialDays;
        if (!days) throw new AppError(400, "This plan has no trial period. Enter the number of trial days.");
        status = "trial";
        trialEnds = end = new Date(now.getTime() + days * 86_400_000);
      } else if (mode === "complimentary") {
        status = "active";
        if (body.until) {
          const u = new Date(String(body.until));
          if (Number.isNaN(u.getTime()) || u <= now) throw new AppError(400, "The end date must be in the future");
          end = u;
        }
      }
      sub = await tx.platformSubscription.create({ data: { businessId: b.id, ...common, status, startedAt: now, trialEndsAt: trialEnds, currentPeriodEnd: end } });
    }
    // The plan's features become the business's modules (what the existing module check enforces).
    await tx.business.update({ where: { id: b.id }, data: { modules: plan.modules, updatedAt: now } });
    await event(tx, b.id, adminId, existing ? "plan_changed" : `started_${mode}`, from, sub.status, { plan: plan.name, cycle, agreed, maxBranches, maxEmployees, graceDays, reason });
    await tx.platformAuditLog.create({ data: { adminId, action: existing ? "subscription.plan_change" : "subscription.assign", businessId: b.id, reason, details: { plan: plan.name, cycle, agreed, mode, maxBranches, maxEmployees } } });
    return sub;
  });
  return formatSubscription(result);
}

async function subscriptionFor(businessIdText: string) {
  const b = await businessOf(businessIdText);
  const sub = await prisma.platformSubscription.findUnique({ where: { businessId: b.id } });
  if (!sub) throw new AppError(404, "This business has no subscription yet. Assign a plan first.");
  return { b, sub };
}

async function setStatus(adminId: bigint, businessIdText: string, reasonIn: unknown, action: string, patch: (sub: SubRow, now: Date) => Prisma.PlatformSubscriptionUncheckedUpdateInput, guard?: (sub: SubRow, now: Date) => void) {
  const reason = cleanReason(reasonIn);
  const { b, sub } = await subscriptionFor(businessIdText);
  const now = new Date();
  guard?.(sub, now);
  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.platformSubscription.update({ where: { id: sub.id }, data: { ...patch(sub, now), updatedAt: now } });
    await event(tx, b.id, adminId, action, sub.status, u.status, { reason });
    await tx.platformAuditLog.create({ data: { adminId, action: `subscription.${action}`, businessId: b.id, reason, details: { from: sub.status, to: u.status } } });
    return u;
  });
  return formatSubscription(updated);
}

export const suspendSubscription = (adminId: bigint, id: string, reason: unknown) =>
  setStatus(adminId, id, reason, "suspend", () => ({ status: "suspended" }), (s) => { if (s.status === "suspended") throw new AppError(409, "Already suspended"); });

/** Lifts a suspension. If the paid period already ran out, it must be extended or paid first, so access is never restored for free by accident. */
export const reactivateSubscription = (adminId: bigint, id: string, reason: unknown) =>
  setStatus(adminId, id, reason, "reactivate", () => ({ status: "active", cancelledAt: null }), (s, now) => {
    if (!["suspended", "cancelled", "expired", "pending_payment"].includes(s.status)) throw new AppError(409, "This subscription is not suspended or cancelled");
    if (s.status === "pending_payment") throw new AppError(409, "It is waiting for its first payment. Record and approve the payment to activate it.");
    if (s.currentPeriodEnd && s.currentPeriodEnd <= now) throw new AppError(409, "The paid period has ended. Record a payment or extend it first.");
  });

export const cancelSubscription = (adminId: bigint, id: string, reason: unknown) =>
  setStatus(adminId, id, reason, "cancel", (_s, now) => ({ status: "cancelled", cancelledAt: now }), (s) => { if (s.status === "cancelled") throw new AppError(409, "Already cancelled"); });

/** Gives extra days (a goodwill extension) without any payment. Always logged with its reason. */
export async function extendSubscription(adminId: bigint, businessIdText: string, daysIn: unknown, reasonIn: unknown) {
  const days = wholeNumber(daysIn, "Days", 1, 3650, false)!;
  return setStatus(adminId, businessIdText, reasonIn, "extend",
    (s, now) => {
      const base = s.currentPeriodEnd && s.currentPeriodEnd > now ? s.currentPeriodEnd : now;
      const end = new Date(base.getTime() + days * 86_400_000);
      return { currentPeriodEnd: end, status: s.status === "expired" || s.status === "grace" || s.status === "past_due" ? "active" : s.status, ...(s.status === "trial" ? { trialEndsAt: end } : {}) };
    },
    (s) => { if (s.status === "pending_payment") throw new AppError(409, "It is waiting for its first payment. Record and approve the payment instead."); });
}

/** Change what one customer is entitled to or pays, without touching their plan or paid period. */
export async function updateSubscriptionTerms(adminId: bigint, businessIdText: string, body: Record<string, unknown>) {
  const patch: Prisma.PlatformSubscriptionUncheckedUpdateInput = {};
  if (body.agreedPrice !== undefined) patch.agreedPrice = money(body.agreedPrice, "Agreed price")!;
  if (body.graceDays !== undefined) patch.graceDays = wholeNumber(body.graceDays, "Grace days", 0, 90, false)!;
  if (body.maxBranches !== undefined) patch.maxBranches = wholeNumber(body.maxBranches, "Branch limit", 1, 10_000, true);
  if (body.maxEmployees !== undefined) patch.maxEmployees = wholeNumber(body.maxEmployees, "Staff limit", 1, 100_000, true);
  if (body.notes !== undefined) patch.notes = text(body.notes, "Notes", 1000);
  if (Object.keys(patch).length === 0) throw new AppError(400, "Nothing to change");
  return setStatus(adminId, businessIdText, body.reason, "terms_changed", (s) => { void s; return patch; });
}

// ---------------------------------------------------------------- payments

type PayRow = Awaited<ReturnType<typeof prisma.platformPayment.findFirstOrThrow>>;
export function formatPayment(p: PayRow) {
  return {
    id: p.publicId, businessName: p.businessName, planName: p.planName, amount: num(p.amount), expectedAmount: num(p.expectedAmount), currency: p.currency,
    method: p.method, reference: p.reference, status: p.status, billingCycle: p.billingCycle, periods: p.periods, paidAt: p.paidAt,
    periodFrom: p.periodFrom, periodTo: p.periodTo, receiptNo: p.receiptNo, note: p.note, decisionReason: p.decisionReason, decidedAt: p.decidedAt, createdAt: p.createdAt,
  };
}
const METHODS = ["cash", "bank", "mpesa", "card", "other"];

/** Writes down money that was received outside the app (cash, bank transfer, M-Pesa paybill statement). It counts for nothing until approved. */
export async function recordPayment(adminId: bigint, businessIdText: string, body: Record<string, unknown>) {
  const { b, sub } = await subscriptionFor(businessIdText);
  const amount = money(body.amount, "Amount")!;
  if (amount <= 0) throw new AppError(400, "Amount must be more than 0");
  const method = String(body.method ?? "");
  if (!METHODS.includes(method)) throw new AppError(400, `Payment method must be one of: ${METHODS.join(", ")}`);
  const reference = (text(body.reference, "Reference", 120) ?? "").toUpperCase() || null;
  if (method !== "cash" && !reference) throw new AppError(400, "Enter the bank or M-Pesa reference so the same payment cannot be counted twice");
  const periods = body.periods === undefined || body.periods === "" ? 1 : wholeNumber(body.periods, "Periods", 1, 60, false)!;
  const paidAt = body.paidAt ? new Date(String(body.paidAt)) : new Date();
  if (Number.isNaN(paidAt.getTime()) || paidAt.getTime() > Date.now() + 86_400_000) throw new AppError(400, "The payment date is not valid");
  const expected = round2(Number(sub.agreedPrice) * (sub.billingCycle === "one_time" ? 1 : periods));
  try {
    const p = await prisma.platformPayment.create({
      data: {
        businessId: b.id, businessName: b.name, planName: sub.planName, amount, expectedAmount: expected, currency: sub.currency, method, reference,
        billingCycle: sub.billingCycle, periods: sub.billingCycle === "one_time" ? 1 : periods, paidAt, note: text(body.note, "Note", 1000), recordedBy: adminId,
      },
    });
    await prisma.$transaction([
      prisma.platformSubscriptionEvent.create({ data: { businessId: b.id, adminId, event: "payment_recorded", fromStatus: sub.status, toStatus: sub.status, details: { amount, method, reference } } }),
      prisma.platformAuditLog.create({ data: { adminId, action: "payment.record", businessId: b.id, reason: `Recorded ${method} payment of ${amount}`, details: { payment: p.publicId, amount, method, reference } } }),
    ]);
    return formatPayment(p);
  } catch (e) {
    if ((e as { code?: string })?.code === "P2002") throw new AppError(409, "A payment with this method and reference is already recorded");
    throw e;
  }
}

/**
 * The only way paid time is added. Safe to call twice: the first call claims the payment (pending -> approved in one
 * statement) and a second one finds nothing to claim, so a double click or a retry can never extend the period twice.
 */
export async function approvePayment(adminId: bigint, paymentIdText: string, reasonIn: unknown) {
  const reason = cleanReason(reasonIn);
  const publicId = requirePublicId(paymentIdText, "A valid payment ID is required");
  const out = await prisma.$transaction(async (tx) => {
    const p = await tx.platformPayment.findUnique({ where: { publicId } });
    if (!p) throw new AppError(404, "Payment not found");
    const claimed = await tx.platformPayment.updateMany({ where: { id: p.id, status: "pending" }, data: { status: "approved", decidedBy: adminId, decidedAt: new Date(), decisionReason: reason } });
    if (claimed.count === 0) throw new AppError(409, `This payment is already ${p.status}`);
    // Serialise with any other change to the same subscription.
    const locked = await tx.$queryRaw<{ id: bigint }[]>`select id from platform_subscriptions where business_id = ${p.businessId} for update`;
    if (locked.length === 0) throw new AppError(409, "This business no longer has a subscription");
    const sub = await tx.platformSubscription.findUniqueOrThrow({ where: { id: locked[0]!.id } });
    const now = new Date();
    const cycle = sub.billingCycle as BillingCycle;
    const { from, to } = nextPeriodEnd(cycle, sub.status === "trial" ? null : sub.currentPeriodEnd, p.periods, now);
    const seq = (await tx.$queryRaw<{ n: bigint }[]>`select nextval('platform_receipt_seq') as n`)[0]!.n;
    const receiptNo = `RCT-${now.getUTCFullYear()}-${String(seq).padStart(6, "0")}`;
    const stayedSuspended = sub.status === "suspended";
    const updated = await tx.platformSubscription.update({
      where: { id: sub.id },
      data: { currentPeriodEnd: to, status: stayedSuspended ? "suspended" : "active", cancelledAt: stayedSuspended ? sub.cancelledAt : null, trialEndsAt: sub.status === "trial" ? null : sub.trialEndsAt, updatedAt: now },
    });
    const done = await tx.platformPayment.update({ where: { id: p.id }, data: { receiptNo, periodFrom: from, periodTo: to } });
    await event(tx, p.businessId, adminId, "payment_approved", sub.status, updated.status, { payment: p.publicId, receiptNo, amount: num(p.amount), periodFrom: from, periodTo: to, reason });
    await tx.platformAuditLog.create({ data: { adminId, action: "payment.approve", businessId: p.businessId, reason, details: { payment: p.publicId, receiptNo, amount: num(p.amount), periodTo: to, stayedSuspended } } });
    return { payment: formatPayment(done), subscription: formatSubscription(updated), stayedSuspended };
  });
  return out;
}

export async function rejectPayment(adminId: bigint, paymentIdText: string, reasonIn: unknown) {
  const reason = cleanReason(reasonIn);
  const publicId = requirePublicId(paymentIdText, "A valid payment ID is required");
  return prisma.$transaction(async (tx) => {
    const p = await tx.platformPayment.findUnique({ where: { publicId } });
    if (!p) throw new AppError(404, "Payment not found");
    const r = await tx.platformPayment.updateMany({ where: { id: p.id, status: "pending" }, data: { status: "rejected", decidedBy: adminId, decidedAt: new Date(), decisionReason: reason } });
    if (r.count === 0) throw new AppError(409, `This payment is already ${p.status}`);
    await event(tx, p.businessId, adminId, "payment_rejected", null, null, { payment: p.publicId, reason });
    await tx.platformAuditLog.create({ data: { adminId, action: "payment.reject", businessId: p.businessId, reason, details: { payment: p.publicId, amount: num(p.amount) } } });
    return formatPayment(await tx.platformPayment.findUniqueOrThrow({ where: { id: p.id } }));
  });
}

/**
 * Marks an approved payment as refunded (money was given back outside the app). It does NOT take paid time away by
 * itself: if access should end, use Suspend or Cancel. This keeps a refund from silently locking a customer out.
 */
export async function refundPayment(adminId: bigint, paymentIdText: string, reasonIn: unknown) {
  const reason = cleanReason(reasonIn);
  const publicId = requirePublicId(paymentIdText, "A valid payment ID is required");
  return prisma.$transaction(async (tx) => {
    const p = await tx.platformPayment.findUnique({ where: { publicId } });
    if (!p) throw new AppError(404, "Payment not found");
    const r = await tx.platformPayment.updateMany({ where: { id: p.id, status: "approved" }, data: { status: "refunded", decisionReason: reason, decidedAt: new Date(), decidedBy: adminId } });
    if (r.count === 0) throw new AppError(409, "Only an approved payment can be marked refunded");
    await event(tx, p.businessId, adminId, "payment_refunded", null, null, { payment: p.publicId, receiptNo: p.receiptNo, reason });
    await tx.platformAuditLog.create({ data: { adminId, action: "payment.refund", businessId: p.businessId, reason, details: { payment: p.publicId, amount: num(p.amount) } } });
    return formatPayment(await tx.platformPayment.findUniqueOrThrow({ where: { id: p.id } }));
  });
}

export async function listPayments(q: { status?: string; limit?: number }) {
  const where: Prisma.PlatformPaymentWhereInput = {};
  if (q.status && ["pending", "approved", "rejected", "refunded"].includes(q.status)) where.status = q.status;
  const rows = await prisma.platformPayment.findMany({ where, orderBy: { createdAt: "desc" }, take: Math.min(Math.max(q.limit ?? 100, 1), 500) });
  const ids = [...new Set(rows.map((r) => r.businessId))];
  const biz = await prisma.business.findMany({ where: { id: { in: ids } }, select: { id: true, publicId: true } });
  const pub = new Map(biz.map((b) => [String(b.id), b.publicId]));
  return rows.map((r) => ({ ...formatPayment(r), businessId: pub.get(String(r.businessId)) ?? null }));
}

// ---------------------------------------------------------------- what the business itself sees

export async function billingSummaryFor(businessId: bigint) {
  const sub = await prisma.platformSubscription.findUnique({ where: { businessId } });
  if (!sub) return { legacy: true as const };
  const [payments, usage] = await Promise.all([
    prisma.platformPayment.findMany({ where: { businessId, status: { in: ["approved", "refunded"] } }, orderBy: { paidAt: "desc" }, take: 50 }),
    usageOf(businessId),
  ]);
  return { legacy: false as const, subscription: formatSubscription(sub), usage, payments: payments.map(formatPayment) };
}
