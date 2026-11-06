import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import prisma from "../lib/prisma.js";

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
    where: { email },
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

  if (!user || !user.isActive) {
    throw new Error("Invalid email or password");
  }

  const passwordMatches = await bcrypt.compare(
    password,
    user.passwordHash
  );

  if (!passwordMatches) {
    throw new Error("Invalid email or password");
  }

  const jwtSecret = process.env.JWT_SECRET;

  if (!jwtSecret) {
    throw new Error("JWT_SECRET is not configured");
  }

  const token = jwt.sign(
    { userId: user.id.toString() },
    jwtSecret,
    { expiresIn: "7d" }
  );

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
