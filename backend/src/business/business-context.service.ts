import prisma from "../lib/prisma.js";
import { resolvePermissions } from "../auth/permissions.js";

export const SUSPENDED_MESSAGE = "This business account is suspended. Please contact support.";

/** Tells a suspended business apart from a business the user simply does not belong to. */
export async function denialMessage(userId: bigint, businessId: bigint): Promise<string> {
  const suspended = await prisma.businessUser.findFirst({
    where: { userId, businessId, isActive: true, business: { isActive: false } },
    select: { id: true },
  });
  return suspended ? SUSPENDED_MESSAGE : "You do not have access to this business";
}

export async function verifyBusinessAccess(
  userId: string,
  businessId: string
) {
  const membership = await prisma.businessUser.findFirst({
    where: {
      userId: BigInt(userId),
      businessId: BigInt(businessId),
      isActive: true,
      business: {
        isActive: true,
      },
    },
    include: {
      business: true,
      role: true,
    },
  });

  if (!membership) {
    throw new Error(await denialMessage(BigInt(userId), BigInt(businessId)));
  }

  return {
    businessId: membership.business.id.toString(),
    businessName: membership.business.name,
    businessType: membership.business.businessType,
    role: membership.role.name,
    permissions: Array.from(
      resolvePermissions(
        membership.role.name,
        membership.role.permissions,
        membership.business.ownerUserId === BigInt(userId)
      )
    ).sort(),
  };
}