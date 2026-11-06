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

export async function getBusinessProfile(businessId: bigint) {
  const business = await prisma.business.findUnique({
    where: {
      id: businessId,
    },
    select: {
      id: true,
      name: true,
      businessType: true,
      email: true,
      phone: true,
      address: true,
      currency: true,
      timezone: true,
    },
  });

  if (!business) {
    return null;
  }

  return {
    ...business,
    id: business.id.toString(),
  };
}

export type BusinessProfileUpdate = {
  name?: string;
  businessType?: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  currency?: string;
  timezone?: string;
};

export async function updateBusinessProfile(
  businessId: bigint,
  data: BusinessProfileUpdate
) {
  const business = await prisma.business.update({
    where: {
      id: businessId,
    },
    data,
    select: {
      id: true,
      name: true,
      businessType: true,
      email: true,
      phone: true,
      address: true,
      currency: true,
      timezone: true,
    },
  });

  return {
    ...business,
    id: business.id.toString(),
  };
}
