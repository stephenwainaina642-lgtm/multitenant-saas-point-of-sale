import jwt from "jsonwebtoken";
import { AppError } from "./errors.js";

export function signToken(userId: string): string {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    // Startup validation normally prevents this; never leak the detail.
    throw new AppError(500, "Server is not configured correctly");
  }

  const options: jwt.SignOptions = {
    expiresIn: (process.env.JWT_EXPIRES_IN || "7d") as NonNullable<jwt.SignOptions["expiresIn"]>,
  };

  return jwt.sign({ userId }, secret, options);
}
