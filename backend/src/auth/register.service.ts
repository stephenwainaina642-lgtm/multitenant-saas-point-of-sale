import bcrypt from "bcryptjs";
import { starterRoleRows } from "./permissions.js";
import prisma from "../lib/prisma.js";
import { AppError } from "../lib/errors.js";
import { signToken } from "../lib/token.js";
import { checkInvite, consumeInvite } from "../platform/invites.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

import { BUSINESS_TYPES } from "../lib/business-presets.js";

type RegisterInput = {
  name: string;
  email: string;
  password: string;
  businessName: string;
  businessType?: string;
  /** Sign-up by invitation: the link token and the PIN given separately. */
  invite?: { token: unknown; pin: unknown };
  /** Whether anyone may sign up without an invitation (OPEN_REGISTRATION=1). */
  openRegistration?: boolean;
};

export async function registerUser(input: RegisterInput) {
  const {
    name,
    email,
    password,
    businessName,
    businessType = "retail",
    invite: inviteInput,
    openRegistration = false,
  } = input;

  if (
    typeof name !== "string" || typeof email !== "string" ||
    typeof password !== "string" || typeof businessName !== "string"
  ) {
    throw new AppError(400, "Name, email, password, and business name must be text");
  }

  const normalizedEmail = email.trim().toLowerCase();

  if (!EMAIL_PATTERN.test(normalizedEmail) || normalizedEmail.length > 255) {
    throw new AppError(400, "Enter a valid email address");
  }
  if (!name.trim() || name.trim().length > 255) {
    throw new AppError(400, "Name is required (max 255 characters)");
  }
  if (!businessName.trim() || businessName.trim().length > 255) {
    throw new AppError(400, "Business name is required (max 255 characters)");
  }
  if (!BUSINESS_TYPES.includes(String(businessType))) {
    throw new AppError(400, `Business type must be one of: ${BUSINESS_TYPES.join(", ")}`);
  }
  if (password.length < 8) {
    throw new AppError(400, "Password must be at least 8 characters long");
  }
  if (Buffer.byteLength(password, "utf8") > 72) {
    throw new AppError(400, "Password must be at most 72 bytes long");
  }

  if (!inviteInput?.token && !openRegistration) {
    throw new AppError(403, "Sign-up is by invitation only. Ask us for an invitation link.");
  }
  const invite = inviteInput?.token ? await checkInvite(inviteInput.token, inviteInput.pin, normalizedEmail) : null;

  const existingUser = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (existingUser) {
    throw new AppError(409, "A user with this email already exists");
  }

  const passwordHash = await bcrypt.hash(password, 12);

  let result;
  try {
    result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        name: name.trim(),
        email: normalizedEmail,
        passwordHash,
      },
    });

    const business = await tx.business.create({
      data: {
        name: businessName.trim(),
        businessType,
        ownerUserId: user.id,
        // An invitation can say "approve on sign-up"; otherwise the business waits for the platform team.
        approvalStatus: invite && !invite.autoApprove ? "pending" : "approved",
      },
    });
    if (invite) await consumeInvite(tx, invite.id, business.id);

    const ownerRole = await tx.role.create({
      data: {
        name: "owner",
        description: "Business owner with full access",
        businessId: business.id,
      },
    });

    await tx.role.createMany({ data: starterRoleRows(business.id) });

    await tx.businessUser.create({
      data: {
        businessId: business.id,
        userId: user.id,
        roleId: ownerRole.id,
      },
    });

    return { user, business, role: ownerRole };
    });
  } catch (error) {
    // Two simultaneous registrations with the same email: the loser gets a clean message.
    if ((error as { code?: string })?.code === "P2002") {
      throw new AppError(409, "A user with this email already exists");
    }
    throw error;
  }

  const token = signToken(result.user.id.toString());

  return {
    token,
    user: {
      id: result.user.id.toString(),
      name: result.user.name,
      email: result.user.email,
    },
    businesses: [
      {
        id: result.business.id.toString(),
        name: result.business.name,
        role: result.role.name,
      },
    ],
  };
}