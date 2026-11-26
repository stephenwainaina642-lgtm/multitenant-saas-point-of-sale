import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import prisma from "../lib/prisma.js";
import { requirePublicId } from "../lib/public-id.js";
import { AppError } from "../lib/errors.js";
import { decimalToCents } from "../lib/money.js";
import { personName, phoneNumber } from "../lib/validate.js";
import { BUILT_IN_ROLES, missingForGrant } from "../auth/permissions.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Actor = { userId: bigint; permissions?: ReadonlySet<string> | undefined; isOwner?: boolean | undefined };

function tempPassword(): string {
  // 12 chars, unambiguous alphabet, from a CSPRNG.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  return Array.from(crypto.randomBytes(12), (b) => alphabet[b % alphabet.length]).join("");
}

function format(m: {
  id: bigint; publicId: string; userId: bigint; isActive: boolean; createdAt: Date; branch?: { publicId: string } | null;
  user: { publicId: string; name: string; email: string; phone: string | null; isActive: boolean };
  role: { publicId: string; name: string };
}, ownerUserId: bigint | null) {
  return {
    id: m.publicId,
    userId: m.user.publicId,
    name: m.user.name,
    email: m.user.email,
    phone: m.user.phone,
    role: { id: m.role.publicId, name: m.role.name },
    branchId: m.branch?.publicId ?? null,
    isOwner: ownerUserId === m.userId,
    isActive: m.isActive,
    createdAt: m.createdAt,
  };
}

const include = { user: true, role: true, branch: { select: { publicId: true } } } as const;

async function ownerOf(businessId: bigint) {
  const b = await prisma.business.findUnique({ where: { id: businessId }, select: { ownerUserId: true } });
  return b?.ownerUserId ?? null;
}

export async function listEmployees(businessId: string) {
  const bizId = BigInt(businessId);
  const owner = await ownerOf(bizId);
  const rows = await prisma.businessUser.findMany({ where: { businessId: bizId }, include, orderBy: { id: "asc" } });
  return rows.map((m) => format(m, owner));
}

export async function resolveRole(businessId: bigint, roleId: unknown, roleName: unknown, actor?: Actor) {
  let role = null;
  if (roleId !== undefined && roleId !== null && roleId !== "") {
    role = await prisma.role.findFirst({ where: { publicId: requirePublicId(roleId, "A valid role ID is required"), businessId } });
  } else if (typeof roleName === "string" && roleName.trim()) {
    const wanted = roleName.trim().toLowerCase();
    role = await prisma.role.findFirst({ where: { businessId, name: { equals: wanted, mode: "insensitive" } } });
    if (!role && wanted in BUILT_IN_ROLES && wanted !== "owner") {
      const label = wanted.replace(/\b\w/g, (c) => c.toUpperCase());
      role = await prisma.role.create({ data: { businessId, name: label, permissions: [...BUILT_IN_ROLES[wanted]!] } });
    }
  } else {
    throw new AppError(400, "A role is required");
  }
  if (!role) throw new AppError(400, "Role not found in this business");
  if (role.name.trim().toLowerCase() === "owner") {
    throw new AppError(400, "The owner role cannot be assigned to employees");
  }
  const missing = actor ? missingForGrant(actor, role.permissions) : [];
  if (missing.length > 0) throw new AppError(403, "You cannot give someone a role with permissions you do not hold yourself");
  return role;
}

async function findMember(businessId: bigint, idText: string) {
  const publicId = requirePublicId(idText, "A valid employee ID is required");
  const m = await prisma.businessUser.findFirst({ where: { publicId, businessId }, include });
  if (!m) throw new AppError(404, "Employee not found");
  return m;
}

function assertNotOwner(m: { userId: bigint }, owner: bigint | null) {
  if (owner === m.userId) throw new AppError(400, "The business owner cannot be changed here");
}

async function onlyInThisBusiness(userId: bigint, businessId: bigint) {
  const others = await prisma.businessUser.count({ where: { userId, businessId: { not: businessId } } });
  return others === 0;
}

export async function addEmployee(
  businessId: string,
  data: { name?: unknown; email?: unknown; phone?: unknown; password?: unknown; roleId?: unknown; roleName?: unknown },
  actor: Actor
) {
  const bizId = BigInt(businessId);
  if (typeof data.email !== "string" || !EMAIL_PATTERN.test(data.email.trim().toLowerCase()) || data.email.length > 255) {
    throw new AppError(400, "Enter a valid email address");
  }
  const email = data.email.trim().toLowerCase();
  const role = await resolveRole(bizId, data.roleId, data.roleName, actor);

  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    // Never touch another account's password or profile; only grant access.
    if (!existing.isActive) throw new AppError(409, "This user account is disabled");
    const already = await prisma.businessUser.findUnique({
      where: { businessId_userId: { businessId: bizId, userId: existing.id } },
    });
    if (already) throw new AppError(409, "This person is already an employee of this business");
    const m = await prisma.businessUser.create({
      data: { businessId: bizId, userId: existing.id, roleId: role.id }, include,
    });
    await audit(bizId, actor, "employee.add", m.id, { email, role: role.name, existingAccount: true });
    return { employee: format(m, await ownerOf(bizId)), temporaryPassword: null };
  }

  const rawName = typeof data.name === "string" ? data.name.trim() : "";
  if (!rawName || rawName.length > 255) throw new AppError(400, "Name is required (max 255 characters)");
  const name = personName(rawName);
  const phone = typeof data.phone === "string" ? phoneNumber(data.phone) : null;

  let password = tempPassword();
  let generated = true;
  if (data.password !== undefined) {
    if (typeof data.password !== "string" || data.password.length < 8) {
      throw new AppError(400, "Password must be at least 8 characters long");
    }
    if (Buffer.byteLength(data.password, "utf8") > 72) throw new AppError(400, "Password must be at most 72 bytes long");
    password = data.password;
    generated = false;
  }
  const passwordHash = await bcrypt.hash(password, 12);

  try {
    const m = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { name, email, phone, passwordHash } });
      return tx.businessUser.create({ data: { businessId: bizId, userId: user.id, roleId: role.id }, include });
    });
    await audit(bizId, actor, "employee.add", m.id, { email, role: role.name, existingAccount: false });
    return { employee: format(m, await ownerOf(bizId)), temporaryPassword: generated ? password : null };
  } catch (e: any) {
    if (e?.code === "P2002") throw new AppError(409, "A user with this email already exists");
    throw e;
  }
}

export async function updateEmployee(
  businessId: string, idText: string,
  data: { roleId?: unknown; roleName?: unknown; name?: unknown; phone?: unknown },
  actor: Actor
) {
  const bizId = BigInt(businessId);
  const m = await findMember(bizId, idText);
  assertNotOwner(m, await ownerOf(bizId));

  if (m.userId === actor.userId && (data.roleId !== undefined || data.roleName !== undefined)) {
    throw new AppError(400, "You cannot change your own role");
  }

  let roleId = m.roleId;
  const before = { role: m.role.name };
  if (data.roleId !== undefined || data.roleName !== undefined) {
    roleId = (await resolveRole(bizId, data.roleId, data.roleName, actor)).id;
  }

  const profileChange = data.name !== undefined || data.phone !== undefined;
  if (profileChange && !(await onlyInThisBusiness(m.userId, bizId))) {
    throw new AppError(409, "This person also belongs to another business, so their profile can only be changed by them");
  }

  await prisma.$transaction(async (tx) => {
    if (roleId !== m.roleId) await tx.businessUser.update({ where: { id: m.id }, data: { roleId } });
    if (profileChange) {
      const rawName = data.name === undefined ? m.user.name : typeof data.name === "string" ? data.name.trim() : "";
      if (!rawName || rawName.length > 255) throw new AppError(400, "Name is required (max 255 characters)");
      const name = data.name === undefined ? rawName : personName(rawName);
      const phone = data.phone === undefined ? m.user.phone : typeof data.phone === "string" ? phoneNumber(data.phone) : null;
      await tx.user.update({ where: { id: m.userId }, data: { name, phone } });
    }
  });

  const fresh = await findMember(bizId, idText);
  await audit(bizId, actor, "employee.update", m.id, { before, after: { role: fresh.role.name } });
  return format(fresh, await ownerOf(bizId));
}

export async function setEmployeeActive(businessId: string, idText: string, active: boolean, actor: Actor) {
  const bizId = BigInt(businessId);
  const m = await findMember(bizId, idText);
  assertNotOwner(m, await ownerOf(bizId));
  if (m.userId === actor.userId) throw new AppError(400, "You cannot deactivate yourself");
  if (m.isActive !== active) {
    await prisma.businessUser.update({ where: { id: m.id }, data: { isActive: active } });
  }
  await audit(bizId, actor, active ? "employee.activate" : "employee.deactivate", m.id, { email: m.user.email });
  return format(await findMember(bizId, idText), await ownerOf(bizId));
}

export async function resetEmployeePassword(businessId: string, idText: string, actor: Actor) {
  const bizId = BigInt(businessId);
  const m = await findMember(bizId, idText);
  assertNotOwner(m, await ownerOf(bizId));
  if (!(await onlyInThisBusiness(m.userId, bizId))) {
    throw new AppError(409, "This person also belongs to another business, so only they can reset their password");
  }
  const password = tempPassword();
  await prisma.user.update({ where: { id: m.userId }, data: { passwordHash: await bcrypt.hash(password, 12) } });
  await audit(bizId, actor, "employee.reset_password", m.id, { email: m.user.email });
  return { temporaryPassword: password };
}

async function audit(businessId: bigint, actor: Actor, action: string, entityId: bigint, details: object) {
  await prisma.auditLog.create({
    data: { businessId, userId: actor.userId, action, entity: "employee", entityId, details },
  });
}

/** One person's profile: details plus what they have sold. Figures count completed sales only. */
export async function employeeProfile(businessId: string, idText: string) {
  const bizId = BigInt(businessId);
  const m = await findMember(bizId, idText);
  const owner = await ownerOf(bizId);
  const where = { businessId: bizId, salespersonId: m.userId, status: "completed" } as const;
  const [rows, recent] = await Promise.all([
    prisma.sale.findMany({ where, select: { total: true, amountPaid: true, balanceDue: true, saleDate: true } }),
    prisma.sale.findMany({
      where, orderBy: { saleDate: "desc" }, take: 10,
      select: { publicId: true, receiptNumber: true, saleDate: true, total: true, paymentStatus: true, customer: { select: { name: true } } },
    }),
  ]);
  const monthAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  let revenue = 0n, collected = 0n, outstanding = 0n, last30Count = 0, last30Revenue = 0n;
  for (const r of rows) {
    const t = decimalToCents(r.total as unknown as string);
    revenue += t;
    collected += decimalToCents(r.amountPaid as unknown as string);
    outstanding += decimalToCents(r.balanceDue as unknown as string);
    if (r.saleDate >= monthAgo) { last30Count += 1; last30Revenue += t; }
  }
  const out = (c: bigint) => Number(c) / 100;
  return {
    employee: format(m, owner),
    stats: {
      salesCount: rows.length, revenue: out(revenue), collected: out(collected), outstanding: out(outstanding),
      last30Days: { salesCount: last30Count, revenue: out(last30Revenue) },
      lastSaleAt: recent[0]?.saleDate ?? null,
    },
    recentSales: recent.map((r) => ({
      id: r.publicId, receiptNumber: r.receiptNumber, saleDate: r.saleDate,
      customerName: r.customer?.name ?? null, total: out(decimalToCents(r.total as unknown as string)), paymentStatus: r.paymentStatus,
    })),
  };
}
