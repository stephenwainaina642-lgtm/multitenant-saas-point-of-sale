import { starterRoleRows } from "../auth/permissions.js";
import prisma from "../lib/prisma.js";
import { AppError } from "../lib/errors.js";
import { BUSINESS_TYPES } from "../lib/business-presets.js";

export const MAX_OWNED_BUSINESSES = 10;

/** Creates a separate business owned by an already signed-in user (own products, stock, customers, reports). */
export async function createBusinessForUser(userId: string, nameIn: unknown, typeIn: unknown) {
  const name = typeof nameIn === "string" ? nameIn.trim() : "";
  const businessType = typeof typeIn === "string" && typeIn ? typeIn : "retail";
  if (!name || name.length > 255) throw new AppError(400, "Business name is required (max 255 characters)");
  if (!BUSINESS_TYPES.includes(businessType)) throw new AppError(400, `Business type must be one of: ${BUSINESS_TYPES.join(", ")}`);
  const uid = BigInt(userId);
  return prisma.$transaction(async (tx) => {
    // Lock the user row so two simultaneous requests cannot both slip past the cap.
    await tx.$queryRaw`select id from users where id = ${uid} for update`;
    const owned = await tx.business.count({ where: { ownerUserId: uid } });
    if (owned >= MAX_OWNED_BUSINESSES) throw new AppError(409, `You can own at most ${MAX_OWNED_BUSINESSES} businesses. Contact support if you need more.`);
    const business = await tx.business.create({ data: { name, businessType, ownerUserId: uid } });
    const role = await tx.role.create({ data: { name: "owner", description: "Business owner with full access", businessId: business.id } });
    await tx.role.createMany({ data: starterRoleRows(business.id) });
    await tx.businessUser.create({ data: { businessId: business.id, userId: uid, roleId: role.id } });
    return { id: business.id.toString(), name: business.name, businessType: business.businessType, role: role.name };
  });
}

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
      taxPin: true,
      vatRegistered: true,
      vatRate: true,
      pricesIncludeVat: true,
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
    vatRate: business.vatRate.toFixed(2),
  };
}

export type BusinessProfileUpdate = {
  name?: string;
  businessType?: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  taxPin?: string | null;
  vatRegistered?: boolean;
  vatRate?: string;
  pricesIncludeVat?: boolean;
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
      taxPin: true,
      vatRegistered: true,
      vatRate: true,
      pricesIncludeVat: true,
      currency: true,
      timezone: true,
    },
  });

  return {
    ...business,
    id: business.id.toString(),
    vatRate: business.vatRate.toFixed(2),
  };
}
