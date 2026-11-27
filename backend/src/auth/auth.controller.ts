import type { NextFunction, Request, Response } from "express";
import { changePassword, confirmPassword, loginUser } from "./auth.service.js";
import type { AuthenticatedRequest } from "./auth.middleware.js";
import { clearSessionCookie, issueSession, SESSION_COOKIE } from "../lib/session-cookie.js";

export async function loginController(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const { email, password } = req.body ?? {};

    if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    const result = await loginUser(email, password);

    return res.status(200).json({
      success: true,
      message: "Login successful",
      data: issueSession(req, res, result),
    });
  } catch (error) {
    // AppError keeps its status (401); anything else becomes a generic 500.
    return next(error);
  }
}

export async function changePasswordController(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const { currentPassword, newPassword } = req.body ?? {};
    if (typeof currentPassword !== "string" || typeof newPassword !== "string" || !currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: "Current and new password are required" });
    }
    const token = await changePassword(BigInt(req.user!.userId), currentPassword, newPassword);
    return res.status(200).json({ success: true, message: "Password changed. Other devices have been signed out.", data: issueSession(req, res, { token }) });
  } catch (error) {
    return next(error);
  }
}

export async function confirmPasswordController(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const { password } = req.body ?? {};
    if (typeof password !== "string" || !password || password.length > 200) {
      return res.status(400).json({ success: false, message: "Password is required" });
    }
    await confirmPassword(BigInt(req.user!.userId), password);
    return res.status(200).json({ success: true, message: "Password confirmed" });
  } catch (error) {
    return next(error);
  }
}

export function logoutController(_req: Request, res: Response) {
  clearSessionCookie(res, SESSION_COOKIE);
  return res.status(200).json({ success: true, message: "Signed out" });
}
