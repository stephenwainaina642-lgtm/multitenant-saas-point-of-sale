import prisma from "../lib/prisma.js";

export async function getUserBusinesses(userId: string) {
  const memberships = await prisma.businessUser.findMany({
    where: {
      userId: BigInt(userId),
      isActive: true,
      business: {
        isActive: true,
      },
    },
    include: {
      business: true,
      role: true,
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  return memberships.map((membership) => ({
    id: membership.business.id.toString(),
    name: membership.business.name,
    businessType: membership.business.businessType,
    email: membership.business.email,
    phone: membership.business.phone,
    address: membership.business.address,
    currency: membership.business.currency,
    timezone: membership.business.timezone,
    role: membership.role.name,
  }));
}