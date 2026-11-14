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
      id: user.id.toString(),
      name: user.name,
      email: user.email,
    },
    businesses: user.memberships.map((membership) => ({
      id: membership.business.id.toString(),
      name: membership.business.name,
      role: membership.role.name,
    })),
  };
}
