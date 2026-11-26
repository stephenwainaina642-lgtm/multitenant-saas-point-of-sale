import crypto from "node:crypto";
import prisma from "../lib/prisma.js";
import { AppError } from "../lib/errors.js";
import { isPackage, PACKAGES } from "../lib/packages.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const INVITE_DAYS = 7;
const MAX_PIN_ATTEMPTS = 5;
const INVALID = "This invitation is not valid. It may have expired, been used, or been cancelled. Ask for a new one.";

const sha = (v: string) => crypto.createHash("sha256").update(v).digest("hex");
// The PIN is bound to its own link token, so one PIN hash can't be replayed against another invite.
const pinHashOf = (token: string, pin: string) => sha(`${sha(token)}:${pin}`);
const safeEqual = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

function cleanReason(v: unknown) {
  const r = typeof v === "string" ? v.trim() : "";
  if (r.length < 3) throw new AppError(400, "A reason (at least 3 characters) is required");
  return r.slice(0, 500);
}

function statusOf(i: { usedAt: Date | null; revokedAt: Date | null; expiresAt: Date; failedAttempts: number }) {
  if (i.usedAt) return "used";
  if (i.revokedAt) return "cancelled";
  if (i.failedAttempts >= MAX_PIN_ATTEMPTS) return "locked";
  if (i.expiresAt.getTime() <= Date.now()) return "expired";
  return "active";
}

/** The link token and PIN are returned ONCE, here; only hashes are kept. */
export async function createInvite(adminId: bigint, data: { email?: unknown; businessName?: unknown; note?: unknown; autoApprove?: unknown; package?: unknown }) {
  if (data.package !== undefined && data.package !== null && data.package !== "" && !isPackage(data.package)) throw new AppError(400, `Package must be one of: ${PACKAGES.join(", ")}`);
  const packageName = isPackage(data.package) ? data.package : null;
  const email = typeof data.email === "string" ? data.email.trim().toLowerCase() : "";
  if (!EMAIL_PATTERN.test(email) || email.length > 255) throw new AppError(400, "Enter the client's email address");
  const businessName = typeof data.businessName === "string" && data.businessName.trim() ? data.businessName.trim().slice(0, 255) : null;
  const note = typeof data.note === "string" && data.note.trim() ? data.note.trim().slice(0, 500) : null;
  if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
    throw new AppError(409, "Someone already has an account with this email");
  }
  const token = crypto.randomBytes(32).toString("base64url");
  const pin = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 24 * 3600 * 1000);
  const invite = await prisma.$transaction(async (tx) => {
    // A new invitation replaces any unused one for the same address, so only one link is ever live per client.
    await tx.businessInvite.updateMany({ where: { email, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    const row = await tx.businessInvite.create({
      data: { tokenHash: sha(token), pinHash: pinHashOf(token, pin), email, businessName, note, packageName, autoApprove: data.autoApprove !== false, createdBy: adminId, expiresAt },
    });
    await tx.platformAuditLog.create({ data: { adminId, action: "invite.create", reason: note ?? "Invitation created", details: { email, businessName, package: packageName, inviteId: row.id.toString() } } });
    return row;
  });
  return { id: invite.id.toString(), email, businessName, expiresAt, token, pin };
}

export async function listInvites() {
  const rows = await prisma.businessInvite.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
  return rows.map((r) => ({
    id: r.id.toString(), email: r.email, businessName: r.businessName, note: r.note, package: r.packageName, autoApprove: r.autoApprove,
    status: statusOf(r), createdAt: r.createdAt, expiresAt: r.expiresAt, usedAt: r.usedAt, usedBusinessId: r.usedBusinessId?.toString() ?? null,
  }));
}

export async function revokeInvite(adminId: bigint, idText: string, reason: unknown) {
  if (!/^[1-9]\d{0,17}$/.test(idText)) throw new AppError(400, "Invalid invitation id");
  const why = cleanReason(reason);
  const res = await prisma.businessInvite.updateMany({ where: { id: BigInt(idText), usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
  if (res.count === 0) throw new AppError(409, "This invitation is already used or cancelled");
  await prisma.platformAuditLog.create({ data: { adminId, action: "invite.revoke", reason: why, details: { inviteId: idText } } });
}

/** For the sign-up page: what the link is for. Reveals nothing about why an invalid link is invalid. */
export async function inviteInfo(token: unknown) {
  const row = typeof token === "string" && token.length >= 20 && token.length <= 100 ? await prisma.businessInvite.findUnique({ where: { tokenHash: sha(token) } }) : null;
  if (!row || statusOf(row) !== "active") throw new AppError(404, INVALID);
  return { email: row.email, businessName: row.businessName };
}

/**
 * Check the link + PIN for a sign-up and return the invite. Wrong PINs are counted; five burn the invite.
 * The caller marks it used inside its own transaction with `consumeInvite`.
 */
export async function checkInvite(token: unknown, pin: unknown, email: string) {
  const row = typeof token === "string" && token.length >= 20 && token.length <= 100 ? await prisma.businessInvite.findUnique({ where: { tokenHash: sha(token) } }) : null;
  if (!row || statusOf(row) !== "active") throw new AppError(403, INVALID);
  const given = typeof pin === "string" ? pin.trim() : "";
  if (!/^\d{6}$/.test(given) || !safeEqual(pinHashOf(token as string, given), row.pinHash)) {
    await prisma.businessInvite.update({ where: { id: row.id }, data: { failedAttempts: { increment: 1 } } });
    throw new AppError(403, "The PIN is not correct");
  }
  if (email !== row.email) throw new AppError(403, "This invitation is for a different email address");
  return row;
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
/** Atomically claim the invite; fails if it was used or cancelled in the meantime. */
export async function consumeInvite(tx: Tx, inviteId: bigint, businessId: bigint) {
  const res = await tx.businessInvite.updateMany({
    where: { id: inviteId, usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date(), usedBusinessId: businessId },
  });
  if (res.count !== 1) throw new AppError(409, INVALID);
}
