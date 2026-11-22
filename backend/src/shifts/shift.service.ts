import prisma from "../lib/prisma.js";
import { requirePublicId } from "../lib/public-id.js";
import { AppError } from "../lib/errors.js";
import { centsToString, decimalToCents, parseMoney } from "../lib/money.js";

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
type Actor = { userId: string; canSeeAll: boolean };

const cents = (v: unknown) => decimalToCents(String(v ?? "0"));

/** What this cashier took and paid out between two instants. Everything is derived from recorded payments/refunds, never typed in. */
async function tally(tx: Tx | typeof prisma, businessId: bigint, userId: bigint, from: Date, to: Date) {
  const received = await tx.$queryRaw<{ method: string; total: string }[]>`
    select lower(method) as method, sum(amount)::text as total from payments
     where business_id = ${businessId} and created_by = ${userId} and payment_date >= ${from} and payment_date <= ${to}
     group by 1`;
  const [refunds] = await tx.$queryRaw<{ total: string }[]>`
    select coalesce(sum(amount), 0)::text as total from refunds
     where business_id = ${businessId} and created_by = ${userId} and lower(method) = 'cash' and created_at >= ${from} and created_at <= ${to}`;
  const [supplier] = await tx.$queryRaw<{ total: string }[]>`
    select coalesce(sum(amount), 0)::text as total from supplier_payments
     where business_id = ${businessId} and created_by = ${userId} and lower(method) = 'cash' and payment_date >= ${from} and payment_date <= ${to}`;
  const byMethod: Record<string, string> = {};
  for (const r of received) byMethod[r.method] = centsToString(cents(r.total));
  return {
    byMethod,
    cashReceived: cents(received.find((r) => r.method === "cash")?.total),
    cashRefunded: cents(refunds?.total),
    cashSupplier: cents(supplier?.total),
  };
}

type ShiftRow = NonNullable<Awaited<ReturnType<typeof prisma.registerShift.findFirst>>> & {
  opener?: { publicId: string; name: string } | null; closer?: { name: string } | null;
};
const money = (v: unknown) => (v === null || v === undefined ? null : centsToString(cents(v)));

function format(s: ShiftRow, live?: Awaited<ReturnType<typeof liveFigures>>) {
  return {
    id: s.publicId, status: s.status, openedBy: s.opener?.publicId ?? null, openedByName: s.opener?.name ?? null,
    openedAt: s.openedAt, openingFloat: money(s.openingFloat),
    closedAt: s.closedAt, closedByName: s.closer?.name ?? null,
    cashReceived: money(s.cashReceived), cashRefunded: money(s.cashRefunded), cashSupplier: money(s.cashSupplier),
    cashPaidOut: money(s.cashPaidOut), expectedCash: money(s.expectedCash), countedCash: money(s.countedCash), variance: money(s.variance),
    totalsByMethod: s.totalsByMethod, closeNote: s.closeNote, managerNote: s.managerNote,
    ...(live && { live }),
  };
}

async function liveFigures(tx: Tx | typeof prisma, s: { businessId: bigint; openedBy: bigint; openedAt: Date; openingFloat: unknown }) {
  const t = await tally(tx, s.businessId, s.openedBy, s.openedAt, new Date());
  return {
    totalsByMethod: t.byMethod, cashReceived: centsToString(t.cashReceived), cashRefunded: centsToString(t.cashRefunded),
    cashSupplier: centsToString(t.cashSupplier),
    expectedCash: centsToString(cents(s.openingFloat) + t.cashReceived - t.cashRefunded - t.cashSupplier),
  };
}

export async function currentShift(businessId: string, userId: string) {
  const s = await prisma.registerShift.findFirst({ where: { businessId: BigInt(businessId), openedBy: BigInt(userId), status: "open" }, include: { opener: true, closer: true } });
  return s ? format(s, await liveFigures(prisma, s)) : null;
}

export async function openShift(businessId: string, userId: string, floatIn: unknown, branchId?: bigint) {
  const openingFloat = parseMoney(floatIn ?? 0, "Opening float");
  if (openingFloat < 0n) throw new AppError(400, "Opening float cannot be negative");
  try {
    const s = await prisma.registerShift.create({
      data: { businessId: BigInt(businessId), ...(branchId && { branchId }), openedBy: BigInt(userId), openingFloat: centsToString(openingFloat) },
      include: { opener: true, closer: true },
    });
    await audit(BigInt(businessId), userId, "shift.open", s.id, { openingFloat: centsToString(openingFloat) });
    return format(s, await liveFigures(prisma, s));
  } catch (e) {
    if ((e as { code?: string })?.code === "P2002") throw new AppError(409, "You already have an open shift. Close it first.");
    throw e;
  }
}

export async function closeShift(businessId: string, actor: Actor, idText: string, body: { countedCash?: unknown; cashPaidOut?: unknown; note?: unknown }) {
  const biz = BigInt(businessId);
  const id = await shiftId(biz, idText);
  const counted = parseMoney(body.countedCash, "Counted cash");
  const paidOut = parseMoney(body.cashPaidOut ?? 0, "Cash paid out");
  if (counted < 0n) throw new AppError(400, "Counted cash cannot be negative");
  if (paidOut < 0n) throw new AppError(400, "Cash paid out cannot be negative");
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 1000) : "";

  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: bigint }[]>`select id from register_shifts where id = ${id} and business_id = ${biz} for update`;
    if (locked.length === 0) throw new AppError(404, "Shift not found");
    const s = await tx.registerShift.findUniqueOrThrow({ where: { id } });
    if (s.status !== "open") throw new AppError(409, "This shift is already closed");
    if (s.openedBy.toString() !== actor.userId && !actor.canSeeAll) throw new AppError(403, "You can only close your own shift");

    const now = new Date();
    const t = await tally(tx, biz, s.openedBy, s.openedAt, now);
    const expected = cents(s.openingFloat) + t.cashReceived - t.cashRefunded - t.cashSupplier - paidOut;
    const variance = counted - expected;
    if (variance !== 0n && !note) throw new AppError(400, "The count does not match the expected cash. Add a note explaining the difference.");

    const closed = await tx.registerShift.update({
      where: { id },
      data: {
        status: "closed", closedAt: now, closedBy: BigInt(actor.userId),
        cashReceived: centsToString(t.cashReceived), cashRefunded: centsToString(t.cashRefunded), cashSupplier: centsToString(t.cashSupplier),
        cashPaidOut: centsToString(paidOut), expectedCash: centsToString(expected), countedCash: centsToString(counted),
        variance: centsToString(variance), totalsByMethod: t.byMethod, closeNote: note || null,
      },
      include: { opener: true, closer: true },
    });
    await audit(biz, actor.userId, "shift.close", id, { expected: centsToString(expected), counted: centsToString(counted), variance: centsToString(variance) }, tx);
    return format(closed);
  });
}

export async function listShifts(businessId: string, actor: Actor, q: { from?: string; to?: string; userId?: string }) {
  const where: Record<string, unknown> = { businessId: BigInt(businessId) };
  if (!actor.canSeeAll) where.openedBy = BigInt(actor.userId);
  else if (q.userId) {
    const who = await prisma.user.findFirst({ where: { publicId: requirePublicId(q.userId, "A valid user ID is required"), memberships: { some: { businessId: BigInt(businessId) } } }, select: { id: true } });
    where.openedBy = who?.id ?? -1n;
  }
  const range: Record<string, Date> = {};
  const f = q.from && new Date(q.from), t = q.to && new Date(q.to);
  if (f && !Number.isNaN(f.getTime())) range.gte = f;
  if (t && !Number.isNaN(t.getTime())) range.lte = t;
  if (Object.keys(range).length) where.openedAt = range;
  const rows = await prisma.registerShift.findMany({ where, orderBy: { openedAt: "desc" }, take: 200, include: { opener: true, closer: true } });
  return rows.map((s) => format(s));
}

export async function getShift(businessId: string, actor: Actor, idText: string) {
  const s = await prisma.registerShift.findFirst({ where: { publicId: requirePublicId(idText, "A valid shift ID is required"), businessId: BigInt(businessId) }, include: { opener: true, closer: true } });
  if (!s || (!actor.canSeeAll && s.openedBy.toString() !== actor.userId)) throw new AppError(404, "Shift not found");
  return format(s, s.status === "open" ? await liveFigures(prisma, s) : undefined);
}

export async function setManagerNote(businessId: string, actorUserId: string, idText: string, noteIn: unknown) {
  const note = typeof noteIn === "string" ? noteIn.trim().slice(0, 1000) : "";
  const id = await shiftId(BigInt(businessId), idText);
  const found = await prisma.registerShift.findFirst({ where: { id, businessId: BigInt(businessId) } });
  if (!found) throw new AppError(404, "Shift not found");
  const s = await prisma.registerShift.update({ where: { id }, data: { managerNote: note || null }, include: { opener: true, closer: true } });
  await audit(BigInt(businessId), actorUserId, "shift.note", id, { note });
  return format(s);
}

/** The internal id for the public shift id in the URL (400 if not a UUID, 404 if not this business's). */
async function shiftId(businessId: bigint, text: string): Promise<bigint> {
  const row = await prisma.registerShift.findFirst({ where: { publicId: requirePublicId(text, "A valid shift ID is required"), businessId }, select: { id: true } });
  if (!row) throw new AppError(404, "Shift not found");
  return row.id;
}

async function audit(businessId: bigint, userId: string, action: string, entityId: bigint, details: object, tx: Tx | typeof prisma = prisma) {
  await tx.auditLog.create({ data: { businessId, userId: BigInt(userId), action, entity: "shift", entityId, details } });
}
