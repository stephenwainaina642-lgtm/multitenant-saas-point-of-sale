import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import prisma from "../lib/prisma.js";

type RegisterInput = {
  name: string;
  email: string;
  password: string;
  businessName: string;
  businessType?: string;
};

export async function registerUser(input: RegisterInput) {
  const {
    name,
    email,
    password,
    businessName,
    businessType = "retail",
  } = input;

  const normalizedEmail = email.trim().toLowerCase();

  const existingUser = await prisma.user.findUnique({
    where: {
      email: normalizedEmail,
    },
  });

  if (existingUser) {
    throw new Error("A user with this email already exists");
  }

  if (password.length < 8) {
    throw new Error("Password must be at least 8 characters long");
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const result = await prisma.$transaction(async (tx) => {
    const business = await tx.business.create({
      data: {
        name: businessName.trim(),
        businessType,
      },
    });

    let ownerRole = await tx.role.findUnique({
      where: {
        name: "owner",
      },
    });

    if (!ownerRole) {
      ownerRole = await tx.role.create({
        data: {
          name: "owner",
          description: "Business owner with full access",
        },
      });
    }

    const user = await tx.user.create({
      data: {
        name: name.trim(),
        email: normalizedEmail,
        passwordHash,
      },
    });

    await tx.businessUser.create({
      data: {
        businessId: business.id,
        userId: user.id,
        roleId: ownerRole.id,
      },
    });

    return {
      user,
      business,
      role: ownerRole,
    };
  });

  const jwtSecret = process.env.JWT_SECRET;

  if (!jwtSecret) {
    throw new Error("JWT_SECRET is not configured");
  }

  const token = jwt.sign(
    {
      userId: result.user.id.toString(),
    },
    jwtSecret,
    {
      expiresIn: "7d",
    }
  );

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