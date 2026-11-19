import { PLATFORM_COOKIE, readCookie } from "../lib/session-cookie.js";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";
import prisma from "../lib/prisma.js";
import { AppError } from "../lib/errors.js";
import { decryptSecret, verifyTotp } from "./totp.js";

// Platform tokens are signed with a key derived from JWT_SECRET, so a normal business token can never pass
// here and a platform token can never pass the normal authenticate middleware (different signature key).
const secret = () => {
  const s = process.env.JWT_SECRET;
  if (!s) throw new AppError(500, "Server is not configured correctly");
  return crypto.createHmac("sha256", s).update("nexapos-platform-token-v1").digest("hex");
};
const AUDIENCE = "platform";
const DUMMY_HASH = "$2b$12$C6UzMDM.H6dfI/f/IKcEeO9r7GDlmFqGkgLBvqfoWzgs5tSJ0RZ3W";
const BAD = "Invalid email, password or authenticator code";

export type PlatformRequest = Request & { admin?: { id: bigint; name: string; email: string } };

export async function platformLogin(email: string, password: string, code: string) {
  const admin = await prisma.platformAdmin.findFirst({ where: { email: { equals: email.trim(), mode: "insensitive" } } });
  const ok = await bcrypt.compare(password, admin?.passwordHash ?? DUMMY_HASH);
  if (!admin || !admin.isActive || !ok) throw new AppError(401, BAD);

  const step = verifyTotp(decryptSecret(admin.totpSecretEnc), code.trim(), Number(admin.totpLastStep));
  if (step === null) throw new AppError(401, BAD);
  // Claim the code atomically so the same code cannot be used twice, even by two simultaneous requests.
  const claimed = await prisma.platformAdmin.updateMany({
    where: { id: admin.id, totpLastStep: { lt: BigInt(step) } },
    data: { totpLastStep: BigInt(step) },
  });
  if (claimed.count !== 1) throw new AppError(401, BAD);

  const token = jwt.sign({ adminId: admin.id.toString() }, secret(), { audience: AUDIENCE, expiresIn: "8h" });
  return { token, admin: { id: admin.id.toString(), name: admin.name, email: admin.email } };
}

export async function requirePlatformAdmin(req: PlatformRequest, res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    const raw = header?.startsWith("Bearer ") ? header.substring(7) : readCookie(req, PLATFORM_COOKIE);
    if (!raw) return res.status(401).json({ success: false, message: "Platform sign-in required" });
    const decoded = jwt.verify(raw, secret(), { audience: AUDIENCE });
    if (typeof decoded === "string" || typeof decoded.adminId !== "string") throw new Error("bad token");
    const admin = await prisma.platformAdmin.findUnique({ where: { id: BigInt(decoded.adminId) } });
    if (!admin || !admin.isActive) throw new Error("inactive");
    if (admin.sessionsValidAfter && (decoded.iat ?? 0) < Math.floor(admin.sessionsValidAfter.getTime() / 1000)) throw new Error("ended");
    req.admin = { id: admin.id, name: admin.name, email: admin.email };
    next();
  } catch {
    res.status(401).json({ success: false, message: "Platform session invalid or expired. Sign in again." });
  }
}
