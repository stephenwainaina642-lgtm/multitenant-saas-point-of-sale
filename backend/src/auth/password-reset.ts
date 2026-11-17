import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import type { Request, Response } from "express";
import prisma from "../lib/prisma.js";
import { loadConfig } from "../lib/config.js";
import { createMailer, type Mail } from "../lib/mailer.js";

const TOKEN_MINUTES = 30;
const MAX_REQUESTS_PER_HOUR = 3;
const GENERIC = "If an account exists for that email, a reset link has been sent.";
const BAD_LINK = "This reset link is invalid or has expired. Request a new one.";

// Built on first use, after dotenv has loaded the environment.
let cached: { config: ReturnType<typeof loadConfig>; send: ((mail: Mail) => Promise<void>) | null } | null = null;
function mail() {
  if (!cached) {
    const config = loadConfig();
    cached = { config, send: createMailer(config) };
  }
  return cached;
}
const sha256 = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

export const capabilitiesController = (_req: Request, res: Response) =>
  res.json({ success: true, data: { passwordResetEmail: mail().send !== null } });

export async function forgotPasswordController(req: Request, res: Response) {
  const { config, send } = mail();
  if (!send) {
    return res.status(503).json({
      success: false,
      message: "Password reset by email is not set up on this server. Ask your business owner or administrator to reset your password.",
    });
  }
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  if (!email || email.length > 255 || !email.includes("@")) {
    return res.status(400).json({ success: false, message: "Enter the email address of your account." });
  }

  // Same answer whether or not the account exists, so this cannot be used to find out who has an account.
  res.json({ success: true, message: GENERIC });

  try {
    const user = await prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" }, isActive: true },
      select: { id: true, name: true, email: true },
    });
    if (!user) return;
    const recent = await prisma.passwordResetToken.count({
      where: { userId: user.id, createdAt: { gt: new Date(Date.now() - 60 * 60 * 1000) } },
    });
    if (recent >= MAX_REQUESTS_PER_HOUR) return;

    const token = crypto.randomBytes(32).toString("hex");
    await prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + TOKEN_MINUTES * 60 * 1000) },
    });
    // The token goes in the URL fragment, which browsers never send to any server.
    const link = `${config.appUrl}/#reset-password=${token}`;
    await send({
      to: user.email,
      subject: "Reset your nexaPOS password",
      text:
        `Hello ${user.name},\n\nUse this link to choose a new password. It works once and expires in ${TOKEN_MINUTES} minutes:\n\n${link}\n\n` +
        `If you did not ask for this, ignore this email; your password has not changed.\n`,
    });
  } catch (error) {
    console.error("Password reset email failed:", error instanceof Error ? error.message : error);
  }
}

export async function resetPasswordController(req: Request, res: Response) {
  const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
  const newPassword = req.body?.newPassword;
  if (typeof newPassword !== "string" || newPassword.length < 8) {
    return res.status(400).json({ success: false, message: "New password must be at least 8 characters" });
  }
  if (Buffer.byteLength(newPassword, "utf8") > 72) {
    return res.status(400).json({ success: false, message: "New password must be at most 72 bytes long" });
  }
  if (!/^[0-9a-f]{64}$/.test(token)) return res.status(400).json({ success: false, message: BAD_LINK });

  const passwordHash = await bcrypt.hash(newPassword, 12);
  const now = new Date();
  try {
    const changed = await prisma.$transaction(async (tx) => {
      // Claim the token atomically: only one request can ever turn it from unused to used.
      const claimed = await tx.passwordResetToken.updateMany({
        where: { tokenHash: sha256(token), usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (claimed.count !== 1) return false;
      const row = await tx.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) }, select: { userId: true } });
      const user = row && (await tx.user.findFirst({ where: { id: row.userId, isActive: true }, select: { id: true } }));
      if (!user) return false;
      await tx.user.update({ where: { id: user.id }, data: { passwordHash, sessionsValidAfter: now, updatedAt: now } });
      // Any other outstanding links for this account stop working too.
      await tx.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: now } });
      return true;
    });
    if (!changed) return res.status(400).json({ success: false, message: BAD_LINK });
    return res.json({ success: true, message: "Password updated. Sign in with your new password." });
  } catch (error) {
    console.error("Reset password error:", error instanceof Error ? error.message : error);
    return res.status(500).json({ success: false, message: "Could not reset the password" });
  }
}
