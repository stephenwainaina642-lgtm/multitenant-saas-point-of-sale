import prisma from "../lib/prisma.js";

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
    throw new Error("You do not have access to this business");
  }

  return {
    businessId: membership.business.id.toString(),
    businessName: membership.business.name,
    businessType: membership.business.businessType,
    role: membership.role.name,
  };
}