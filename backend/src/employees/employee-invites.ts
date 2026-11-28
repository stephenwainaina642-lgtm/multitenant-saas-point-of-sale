import { assertWithinLimit } from "../lib/entitlements.js";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import prisma from "../lib/prisma.js";
import { AppError } from "../lib/errors.js";
import { personName, phoneNumber } from "../lib/validate.js";
import { resolveRole } from "./employee.service.js";

/**
 * Sign-in links for new employees. The owner (or anyone with employees.manage) creates one; the employee opens the
 * link, types the PIN they were given separately and chooses their own password, so nobody else ever sees it.
 * The link token and PIN are shown once; only hashes are stored. Five wrong PINs burn the invitation.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const STAFF_INVITE_DAYS = 7;
const MAX_PIN_ATTEMPTS = 5;
const INVALID = "This sign-in link is not valid. It may have expired, been used, or been cancelled. Ask for a new one.";

const sha = (v: string) => crypto.createHash("sha256").update(v).digest("hex");
const pinHashOf = (token: string, pin: string) => sha(`${sha(token)}:${pin}`);
const safeEqual = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const validToken = (t: unknown): t is string => typeof t === "string" && t.length >= 20 && t.length <= 100;

type Actor = { userId: bigint; permissions?: ReadonlySet<string> | undefined; isOwner?: boolean | undefined };

function statusOf(i: { usedAt: Date | null; revokedAt: Date | null; expiresAt: Date; failedAttempts: number }) {
  if (i.usedAt) return "used";
  if (i.revokedAt) return "cancelled";
  if (i.failedAttempts >= MAX_PIN_ATTEMPTS) return "locked";
  if (i.expiresAt.getTime() <= Date.now()) return "expired";
  return "active";
}

export async function createEmployeeInvite(
  businessId: string,
  data: { name?: unknown; email?: unknown; phone?: unknown; roleId?: unknown; roleName?: unknown },
  actor: Actor
) {
  const bizId = BigInt(businessId);
  await assertWithinLimit(bizId, "employees");
  if (typeof data.email !== "string" || !EMAIL_PATTERN.test(data.email.trim().toLowerCase()) || data.email.length > 255) {
    throw new AppError(400, "Enter a valid email address");
  }
  const email = data.email.trim().toLowerCase();
  const rawName = typeof data.name === "string" ? data.name.trim() : "";
  if (!rawName || rawName.length > 255) throw new AppError(400, "Name is required (max 255 characters)");
  const name = personName(rawName);
  const phone = typeof data.phone === "string" && data.phone.trim() ? phoneNumber(data.phone) : null;
  const role = await resolveRole(bizId, data.roleId, data.roleName, actor);
  if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
    throw new AppError(409, "This email already has an account. Add them from the employee form instead; they keep their own password.");
  }
  const token = crypto.randomBytes(32).toString("base64url");
  const pin = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  const expiresAt = new Date(Date.now() + STAFF_INVITE_DAYS * 24 * 3600 * 1000);
  const row = await prisma.$transaction(async (tx) => {
    // One live link per person per business: a new one replaces any unused one.
    await tx.employeeInvite.updateMany({ where: { businessId: bizId, email, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    const r = await tx.employeeInvite.create({
      data: { businessId: bizId, roleId: role.id, tokenHash: sha(token), pinHash: pinHashOf(token, pin), email, name, phone, createdBy: actor.userId, expiresAt },
    });
    await tx.auditLog.create({ data: { businessId: bizId, userId: actor.userId, action: "employee.invite", entity: "employee_invite", entityId: r.id, details: { email, role: role.name } } });
    return r;
  });
  return { id: row.id.toString(), email, name, role: role.name, expiresAt, token, pin };
}

export async function listEmployeeInvites(businessId: string) {
  const rows = await prisma.employeeInvite.findMany({ where: { businessId: BigInt(businessId) }, orderBy: { createdAt: "desc" }, take: 100 });
  const roles = await prisma.role.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.roleId))] } }, select: { id: true, name: true } });
  const roleName = new Map(roles.map((r) => [r.id, r.name]));
  return rows.map((r) => ({
    id: r.id.toString(), name: r.name, email: r.email, phone: r.phone, role: roleName.get(r.roleId) ?? "",
    status: statusOf(r), createdAt: r.createdAt, expiresAt: r.expiresAt, usedAt: r.usedAt,
  }));
}

export async function cancelEmployeeInvite(businessId: string, idText: string, actor: Actor) {
  if (!/^[1-9]\d{0,17}$/.test(idText)) throw new AppError(400, "Invalid invitation id");
  const bizId = BigInt(businessId);
  const res = await prisma.employeeInvite.updateMany({ where: { id: BigInt(idText), businessId: bizId, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
  if (res.count === 0) {
    // Another business's invitation looks exactly like one that does not exist.
    const mine = await prisma.employeeInvite.count({ where: { id: BigInt(idText), businessId: bizId } });
    throw mine === 0 ? new AppError(404, "Invitation not found") : new AppError(409, "This invitation is already used or cancelled");
  }
  await prisma.auditLog.create({ data: { businessId: bizId, userId: actor.userId, action: "employee.invite_cancel", entity: "employee_invite", entityId: BigInt(idText), details: {} } });
}

/** For the page the employee lands on: who is this link for. Says nothing about why an invalid link is invalid. */
export async function employeeInviteInfo(token: unknown) {
  const row = validToken(token) ? await prisma.employeeInvite.findUnique({ where: { tokenHash: sha(token) } }) : null;
  if (!row || statusOf(row) !== "active") throw new AppError(404, INVALID);
  const biz = await prisma.business.findUnique({ where: { id: row.businessId }, select: { name: true } });
  return { name: row.name, email: row.email, businessName: biz?.name ?? "" };
}

/** Check the PIN, then create the account with the password the employee chose. They sign in normally afterwards. */
export async function acceptEmployeeInvite(data: { token?: unknown; pin?: unknown; password?: unknown }) {
  const token = data.token;
  const row = validToken(token) ? await prisma.employeeInvite.findUnique({ where: { tokenHash: sha(token) } }) : null;
  if (!row || statusOf(row) !== "active") throw new AppError(403, INVALID);
  const pin = typeof data.pin === "string" ? data.pin.trim() : "";
  if (!/^\d{6}$/.test(pin) || !safeEqual(pinHashOf(token as string, pin), row.pinHash)) {
    await prisma.employeeInvite.update({ where: { id: row.id }, data: { failedAttempts: { increment: 1 } } });
    throw new AppError(403, "The PIN is not correct");
  }
  const password = data.password;
  if (typeof password !== "string" || password.length < 8) throw new AppError(400, "Password must be at least 8 characters long");
  if (Buffer.byteLength(password, "utf8") > 72) throw new AppError(400, "Password must be at most 72 bytes long");
  const passwordHash = await bcrypt.hash(password, 12);
  try {
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.employeeInvite.updateMany({
        where: { id: row.id, usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() },
      });
      if (claimed.count !== 1) throw new AppError(409, INVALID);
      const user = await tx.user.create({ data: { name: row.name, email: row.email, phone: row.phone, passwordHash } });
      const m = await tx.businessUser.create({ data: { businessId: row.businessId, userId: user.id, roleId: row.roleId } });
      await tx.employeeInvite.update({ where: { id: row.id }, data: { usedUserId: user.id } });
      await tx.auditLog.create({ data: { businessId: row.businessId, userId: user.id, action: "employee.invite_accept", entity: "employee", entityId: m.id, details: { email: row.email } } });
    });
  } catch (e: any) {
    if (e?.code === "P2002") throw new AppError(409, "An account with this email already exists. Ask the owner to add you directly.");
    throw e;
  }
  return { email: row.email };
}
