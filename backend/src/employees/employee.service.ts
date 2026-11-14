import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import prisma from "../lib/prisma.js";
import { AppError } from "../lib/errors.js";
import { BUILT_IN_ROLES } from "../auth/permissions.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Actor = { userId: bigint };

function tempPassword(): string {
  // 12 chars, unambiguous alphabet, from a CSPRNG.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  return Array.from(crypto.randomBytes(12), (b) => alphabet[b % alphabet.length]).join("");
}

function format(m: {
  id: bigint; userId: bigint; isActive: boolean; createdAt: Date;
  user: { name: string; email: string; phone: string | null; isActive: boolean };
  role: { id: bigint; name: string };
}, ownerUserId: bigint | null) {
  return {
    id: m.id.toString(),
    userId: m.userId.toString(),
    name: m.user.name,
    email: m.user.email,
    phone: m.user.phone,
    role: { id: m.role.id.toString(), name: m.role.name },
    isOwner: ownerUserId === m.userId,
    isActive: m.isActive,
    createdAt: m.createdAt,
  };
}

const include = { user: true, role: true } as const;

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

async function resolveRole(businessId: bigint, roleId: unknown, roleName: unknown) {
  let role = null;
  if (roleId !== undefined && roleId !== null && roleId !== "") {
    if (!/^[1-9]\d*$/.test(String(roleId))) throw new AppError(400, "Invalid role");
    role = await prisma.role.findFirst({ where: { id: BigInt(String(roleId)), businessId } });
  } else if (typeof roleName === "string" && roleName.trim()) {
    const wanted = roleName.trim().toLowerCase();
    role = await prisma.role.findFirst({ where: { businessId, name: { equals: wanted, mode: "insensitive" } } });
    if (!role && wanted in BUILT_IN_ROLES && wanted !== "owner") {
      const label = wanted.replace(/\b\w/g, (c) => c.toUpperCase());
      role = await prisma.role.create({ data: { businessId, name: label, permissions: [] } });
    }
  } else {
    throw new AppError(400, "A role is required");
  }
  if (!role) throw new AppError(400, "Role not found in this business");
  if (role.name.trim().toLowerCase() === "owner") {
    throw new AppError(400, "The owner role cannot be assigned to employees");
  }
  return role;
}

async function findMember(businessId: bigint, idText: string) {
  if (!/^[1-9]\d*$/.test(idText)) throw new AppError(404, "Employee not found");
  const m = await prisma.businessUser.findFirst({ where: { id: BigInt(idText), businessId }, include });
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
  const role = await resolveRole(bizId, data.roleId, data.roleName);

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

  const name = typeof data.name === "string" ? data.name.trim() : "";
  if (!name || name.length > 255) throw new AppError(400, "Name is required (max 255 characters)");
  const phone = typeof data.phone === "string" && data.phone.trim() ? data.phone.trim().slice(0, 50) : null;

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
    roleId = (await resolveRole(bizId, data.roleId, data.roleName)).id;
  }

  const profileChange = data.name !== undefined || data.phone !== undefined;
  if (profileChange && !(await onlyInThisBusiness(m.userId, bizId))) {
    throw new AppError(409, "This person also belongs to another business, so their profile can only be changed by them");
  }

  await prisma.$transaction(async (tx) => {
    if (roleId !== m.roleId) await tx.businessUser.update({ where: { id: m.id }, data: { roleId } });
    if (profileChange) {
      const name = data.name === undefined ? m.user.name : typeof data.name === "string" ? data.name.trim() : "";
      if (!name || name.length > 255) throw new AppError(400, "Name is required (max 255 characters)");
      const phone = data.phone === undefined ? m.user.phone : typeof data.phone === "string" && data.phone.trim() ? data.phone.trim().slice(0, 50) : null;
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
