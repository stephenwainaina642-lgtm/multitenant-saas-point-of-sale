import prisma from "../lib/prisma.js";
import { AppError } from "../lib/errors.js";
import {
  BUILT_IN_ROLES,
  PERMISSION_CATALOG,
  missingForGrant,
  type GrantActor,
  type Permission,
} from "../auth/permissions.js";

function format(role: {
  id: bigint;
  name: string;
  description: string | null;
  permissions: string[];
}) {
  return {
    id: role.id.toString(),
    name: role.name,
    description: role.description,
    permissions: role.permissions,
  };
}

function validatePermissions(input: unknown): Permission[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new AppError(400, "Select at least one permission for the role");
  }

  const unique = [...new Set(input.map(String))];
  const unknown = unique.filter((p) => !(p in PERMISSION_CATALOG));

  if (unknown.length > 0) {
    throw new AppError(400, `Unknown permission: ${unknown[0]}`);
  }

  return unique as Permission[];
}

function validateName(input: unknown): string {
  const name = typeof input === "string" ? input.trim() : "";

  if (!name || name.length > 100) {
    throw new AppError(400, "Role name is required (max 100 characters)");
  }

  if (name.toLowerCase() === "owner") {
    throw new AppError(400, "The owner role is reserved");
  }

  return name;
}

export function getPermissionCatalog() {
  return {
    permissions: Object.entries(PERMISSION_CATALOG).map(([key, label]) => ({
      key,
      label,
    })),
    builtInRoles: Object.entries(BUILT_IN_ROLES).map(([name, permissions]) => ({
      name,
      permissions,
    })),
  };
}

export async function getBusinessRoles(businessId: string) {
  const roles = await prisma.role.findMany({
    where: { businessId: BigInt(businessId) },
    orderBy: { name: "asc" },
  });

  return roles.map(format);
}

async function assertNameFree(businessId: bigint, name: string, exceptId?: bigint) {
  const clash = await prisma.role.findFirst({
    where: {
      businessId,
      name: { equals: name, mode: "insensitive" },
      ...(exceptId !== undefined && { id: { not: exceptId } }),
    },
    select: { id: true },
  });

  if (clash) {
    throw new AppError(409, "A role with this name already exists");
  }
}

function assertMayGrant(actor: GrantActor | undefined, permissions: readonly string[]) {
  const missing = actor ? missingForGrant(actor, permissions) : [];
  if (missing.length > 0) {
    throw new AppError(403, `You cannot grant permissions you do not hold yourself: ${missing.join(", ")}`);
  }
}

export async function createBusinessRole(
  businessId: string,
  data: { name: unknown; description?: unknown; permissions: unknown },
  actor?: GrantActor
) {
  const bizId = BigInt(businessId);
  const name = validateName(data.name);
  const permissions = validatePermissions(data.permissions);
  assertMayGrant(actor, permissions);

  await assertNameFree(bizId, name);

  const role = await prisma.role.create({
    data: {
      businessId: bizId,
      name,
      description:
        typeof data.description === "string" ? data.description.trim() || null : null,
      permissions,
    },
  });

  return format(role);
}

async function findOwnRole(businessId: string, roleId: string) {
  if (!/^[1-9]\d*$/.test(roleId)) {
    throw new AppError(404, "Role not found");
  }

  const role = await prisma.role.findFirst({
    where: { id: BigInt(roleId), businessId: BigInt(businessId) },
  });

  if (!role) {
    throw new AppError(404, "Role not found");
  }

  if (role.name.trim().toLowerCase() === "owner") {
    throw new AppError(400, "The owner role cannot be changed");
  }

  return role;
}

export async function updateBusinessRole(
  businessId: string,
  roleId: string,
  data: { name?: unknown; description?: unknown; permissions?: unknown },
  actor?: GrantActor & { userId?: bigint }
) {
  const role = await findOwnRole(businessId, roleId);

  if (actor && !actor.isOwner) {
    // Nobody but the owner may change the role they themselves hold.
    const mine = actor.userId
      ? await prisma.businessUser.findFirst({ where: { businessId: BigInt(businessId), userId: actor.userId }, select: { roleId: true } })
      : null;
    if (mine && mine.roleId === role.id) throw new AppError(403, "You cannot edit the role you hold yourself. Ask the owner.");
  }

  const name = data.name !== undefined ? validateName(data.name) : role.name;
  const permissions =
    data.permissions !== undefined
      ? validatePermissions(data.permissions)
      : role.permissions;
  if (data.permissions !== undefined) assertMayGrant(actor, permissions);

  if (name.toLowerCase() !== role.name.toLowerCase()) {
    await assertNameFree(BigInt(businessId), name, role.id);
  }

  const updated = await prisma.role.update({
    where: { id: role.id },
    data: {
      name,
      permissions,
      ...(data.description !== undefined && {
        description:
          typeof data.description === "string" ? data.description.trim() || null : null,
      }),
    },
  });

  return format(updated);
}

export async function deleteBusinessRole(businessId: string, roleId: string) {
  const role = await findOwnRole(businessId, roleId);

  const inUse = await prisma.businessUser.count({
    where: { roleId: role.id, businessId: BigInt(businessId) },
  });

  if (inUse > 0) {
    throw new AppError(
      409,
      "This role is assigned to employees. Reassign them before deleting it"
    );
  }

  await prisma.role.delete({ where: { id: role.id } });
}
