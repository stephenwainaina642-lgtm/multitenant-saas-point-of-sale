import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import prisma from "../lib/prisma.js";
import { AppError } from "../lib/errors.js";
import { sendResetLinkTo } from "../auth/password-reset.js";
import { encryptSecret, newTotpSecret, otpauthUri } from "./totp.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Used only by scripts/create-platform-admin.ts — there is no public way to create a platform admin. */
export async function createPlatformAdmin(name: string, email: string, password: string) {
  email = email.trim().toLowerCase();
  if (!name.trim()) throw new Error("Name is required");
  if (!EMAIL_PATTERN.test(email)) throw new Error("Enter a valid e-mail address");
  if (password.length < 12 || Buffer.byteLength(password) > 72) throw new Error("Password must be 12 to 72 characters");
  const secret = newTotpSecret();
  await prisma.platformAdmin.create({
    data: { name: name.trim(), email, passwordHash: await bcrypt.hash(password, 12), totpSecretEnc: encryptSecret(secret) },
  });
  return { secret, uri: otpauthUri(secret, email) };
}

/** Lost phone / rotated JWT_SECRET: issue a new authenticator secret and cut off existing sessions. */
export async function reenrollTotp(email: string) {
  const admin = await prisma.platformAdmin.findFirst({ where: { email: { equals: email.trim(), mode: "insensitive" } } });
  if (!admin) throw new Error("No platform admin with that e-mail");
  const secret = newTotpSecret();
  await prisma.platformAdmin.update({
    where: { id: admin.id },
    data: { totpSecretEnc: encryptSecret(secret), totpLastStep: 0n, sessionsValidAfter: new Date() },
  });
  return { secret, uri: otpauthUri(secret, admin.email) };
}

type Row = Record<string, string | number | boolean | Date | null>;

/** Counts, dates and sale totals only: no customer names, no individual sales, no prices. */
export async function overview() {
  const rows = await prisma.$queryRaw<Row[]>`
    select b.id::text as id, b.name, b.business_type, b.is_active, b.approval_status, b.created_at, b.vat_registered,
           o.name as owner_name, o.email as owner_email,
           (select count(*) from business_users bu where bu.business_id = b.id and bu.is_active)::int as users,
           (select count(*) from products p where p.business_id = b.id)::int as products,
           s.sales_count::int, s.sales_total::text, s.sales_30d_count::int, s.sales_30d_total::text, s.last_sale
    from businesses b
    left join users o on o.id = b.owner_user_id
    left join lateral (
      select count(*) as sales_count,
             coalesce(sum(total), 0)::numeric(14,2) as sales_total,
             count(*) filter (where sale_date >= now() - interval '30 days') as sales_30d_count,
             coalesce(sum(total) filter (where sale_date >= now() - interval '30 days'), 0)::numeric(14,2) as sales_30d_total,
             max(sale_date) as last_sale
      from sales where business_id = b.id and status = 'completed'
    ) s on true
    order by b.created_at desc
    limit 500`;
  const businesses = rows.map((r) => ({
    id: r.id, name: r.name, businessType: r.business_type, isActive: r.is_active, approvalStatus: r.approval_status, createdAt: r.created_at,
    vatRegistered: r.vat_registered, ownerName: r.owner_name, ownerEmail: r.owner_email,
    users: r.users, products: r.products, salesCount: r.sales_count, salesTotal: r.sales_total,
    sales30dCount: r.sales_30d_count, sales30dTotal: r.sales_30d_total, lastSaleAt: r.last_sale,
  }));
  const active30 = businesses.filter((b) => Number(b.sales30dCount) > 0).length;
  const [userRow] = await prisma.$queryRaw<{ users: number }[]>`select count(*)::int as users from users`;
  const users = userRow?.users ?? 0;
  return {
    totals: { businesses: businesses.length, pending: businesses.filter((b) => b.approvalStatus === "pending").length, suspended: businesses.filter((b) => !b.isActive).length, activeLast30Days: active30, users },
    businesses,
  };
}

function cleanReason(reason: unknown): string {
  const r = typeof reason === "string" ? reason.trim() : "";
  if (r.length < 3) throw new AppError(400, "A reason (at least 3 characters) is required");
  if (r.length > 500) throw new AppError(400, "Reason is too long (500 characters at most)");
  return r;
}
async function business(idText: string) {
  if (!/^[1-9]\d{0,17}$/.test(idText)) throw new AppError(400, "Invalid business id");
  const b = await prisma.business.findUnique({ where: { id: BigInt(idText) }, include: { owner: true } });
  if (!b) throw new AppError(404, "Business not found");
  return b;
}

export async function setBusinessActive(adminId: bigint, idText: string, active: boolean, reasonIn: unknown) {
  const reason = cleanReason(reasonIn);
  const b = await business(idText);
  if (b.isActive === active) throw new AppError(409, active ? "This business is already active" : "This business is already suspended");
  await prisma.$transaction([
    prisma.business.update({ where: { id: b.id }, data: { isActive: active } }),
    prisma.platformAuditLog.create({ data: { adminId, action: active ? "business.reactivate" : "business.suspend", businessId: b.id, reason, details: { name: b.name } } }),
  ]);
  return { id: b.id.toString(), isActive: active };
}

export async function setBusinessApproval(adminId: bigint, idText: string, approve: boolean, reasonIn: unknown) {
  const reason = cleanReason(reasonIn);
  const b = await business(idText);
  const next = approve ? "approved" : "rejected";
  if (b.approvalStatus === next) throw new AppError(409, approve ? "This business is already approved" : "This business is already rejected");
  await prisma.$transaction([
    prisma.business.update({ where: { id: b.id }, data: { approvalStatus: next } }),
    prisma.platformAuditLog.create({ data: { adminId, action: approve ? "business.approve" : "business.reject", businessId: b.id, reason, details: { name: b.name, was: b.approvalStatus } } }),
  ]);
  return { id: b.id.toString(), approvalStatus: next };
}

export async function resetOwnerAccess(adminId: bigint, idText: string, reasonIn: unknown) {
  const reason = cleanReason(reasonIn);
  const b = await business(idText);
  if (!b.owner || !b.owner.isActive) throw new AppError(409, "This business has no active owner account");
  const owner = b.owner;
  let temporaryPassword: string | null = null;
  const emailed = await sendResetLinkTo({ id: owner.id, name: owner.name, email: owner.email });
  if (!emailed) {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
    temporaryPassword = Array.from(crypto.randomBytes(14), (x) => alphabet[x % alphabet.length]).join("");
    // Signs the owner out everywhere; they should change this password right after signing in.
    await prisma.user.update({ where: { id: owner.id }, data: { passwordHash: await bcrypt.hash(temporaryPassword, 12), sessionsValidAfter: new Date() } });
  }
  await prisma.platformAuditLog.create({
    data: { adminId, action: "owner.reset_access", businessId: b.id, userId: owner.id, reason, details: { method: emailed ? "email_link" : "temporary_password", ownerEmail: owner.email } },
  });
  return { method: emailed ? "email_link" : "temporary_password", ownerEmail: owner.email, temporaryPassword };
}

export async function auditTrail(limit = 100) {
  const rows = await prisma.platformAuditLog.findMany({ orderBy: { createdAt: "desc" }, take: Math.min(Math.max(limit, 1), 500), include: { admin: { select: { name: true } } } });
  return rows.map((r) => ({ id: r.id.toString(), action: r.action, businessId: r.businessId?.toString() ?? null, reason: r.reason, adminName: r.admin.name, createdAt: r.createdAt, details: r.details }));
}
