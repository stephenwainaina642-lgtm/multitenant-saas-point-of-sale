import prisma from "../lib/prisma.js";
import { resolvePermissions } from "../auth/permissions.js";
import { isPublicId } from "../lib/public-id.js";

export const SUSPENDED_MESSAGE = "This business account is suspended. Please contact support.";

/** Tells a suspended business apart from a business the user simply does not belong to. */
export async function denialMessage(userId: bigint, businessId: bigint): Promise<string> {
  const suspended = await prisma.businessUser.findFirst({
    where: { userId, businessId, isActive: true, business: { isActive: false } },
    select: { id: true },
  });
  if (suspended) return SUSPENDED_MESSAGE;
  const waiting = await prisma.businessUser.findFirst({
    where: { userId, businessId, isActive: true, business: { isActive: true, approvalStatus: { not: "approved" } } },
    select: { business: { select: { approvalStatus: true } } },
  });
  if (waiting) {
    return waiting.business.approvalStatus === "rejected"
      ? "This business was not approved. Contact support."
      : "This business is waiting for approval. You will be able to use it as soon as it is approved.";
  }
  return "You do not have access to this business";
}

export async function verifyBusinessAccess(
  userId: string,
  businessId: string
) {
  // The client names the business by its public UUID; an unknown one is refused like one the user doesn't belong to.
  if (!isPublicId(businessId)) throw new Error("A valid business ID is required");
  const known = await prisma.business.findFirst({ where: { publicId: businessId }, select: { id: true } });
  const internalId = known?.id ?? -1n;
  const membership = await prisma.businessUser.findFirst({
    where: {
      userId: BigInt(userId),
      businessId: internalId,
      isActive: true,
      business: {
        isActive: true,
        approvalStatus: "approved",
      },
    },
    include: {
      business: true,
      role: true,
    },
  });

  if (!membership) {
    throw new Error(await denialMessage(BigInt(userId), internalId));
  }

  return {
    businessId: membership.business.publicId,
    businessName: membership.business.name,
    businessType: membership.business.businessType,
    package: membership.business.packageName,
    modules: membership.business.modules,
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