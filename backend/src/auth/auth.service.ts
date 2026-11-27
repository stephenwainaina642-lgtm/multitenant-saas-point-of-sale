import bcrypt from "bcryptjs";
import prisma from "../lib/prisma.js";
import { AppError } from "../lib/errors.js";
import { signToken } from "../lib/token.js";

// Compared against when the email is unknown, so response time does not reveal
// whether an account exists.
const DUMMY_HASH = "$2b$12$C6UzMDM.H6dfI/f/IKcEeO9r7GDlmFqGkgLBvqfoWzgs5tSJ0RZ3W";

type LoginResult = {
  token: string;
  user: {
    id: string;
    name: string;
    email: string;
  };
  businesses: {
    id: string;
    name: string;
    role: string;
  }[];
};

export async function loginUser(
  email: string,
  password: string
): Promise<LoginResult> {
  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    include: {
      memberships: {
        where: { isActive: true },
        include: {
          business: true,
          role: true,
        },
      },
    },
  });

  const passwordMatches = await bcrypt.compare(
    password,
    user?.passwordHash ?? DUMMY_HASH
  );

  if (!user || !user.isActive || !passwordMatches) {
    throw new AppError(401, "Invalid email or password");
  }

  const token = signToken(user.id.toString());

  return {
    token,
    user: {
      id: user.publicId,
      name: user.name,
      email: user.email,
    },
    businesses: user.memberships.map((membership) => ({
      id: membership.business.publicId,
      name: membership.business.name,
      role: membership.role.name,
    })),
  };
}

/** Checks the signed-in user's own password and changes nothing. Used before a risky local step, such as setting a PIN. */
export async function confirmPassword(userId: bigint, password: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { isActive: true, passwordHash: true } });
  const ok = user ? await bcrypt.compare(password, user.passwordHash) : false;
  if (!user || !user.isActive || !ok) throw new AppError(400, "Password is incorrect");
}

/** Lets a signed-in user replace their own password (e.g. the temporary one an owner issued). */
export async function changePassword(userId: bigint, currentPassword: string, newPassword: string) {
  if (newPassword.length < 8) throw new AppError(400, "New password must be at least 8 characters");
  if (newPassword.length > 200) throw new AppError(400, "New password is too long");
  const user = await prisma.user.findUnique({ where: { id: userId } });
  const ok = user ? await bcrypt.compare(currentPassword, user.passwordHash) : false;
  if (!user || !user.isActive || !ok) throw new AppError(400, "Current password is incorrect");
  if (currentPassword === newPassword) throw new AppError(400, "New password must be different from the current one");
  // Every token issued before now stops working; the caller gets a fresh one so this device stays signed in.
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await bcrypt.hash(newPassword, 12), sessionsValidAfter: new Date() },
  });
  return signToken(userId.toString());
}
