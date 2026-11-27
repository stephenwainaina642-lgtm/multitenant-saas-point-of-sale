import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import prisma from "../lib/prisma.js";
import { readCookie, SESSION_COOKIE } from "../lib/session-cookie.js";

export type AuthenticatedRequest = Request & {
  user?: {
    userId: string;
  };
};

export async function authenticate(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const authHeader = req.headers.authorization;

    // A Bearer header (scripts, tests) wins; browsers send the httpOnly session cookie.
    const token =
      authHeader && authHeader.startsWith("Bearer ")
        ? authHeader.substring(7)
        : readCookie(req, SESSION_COOKIE) ?? "";

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Authentication token is required",
      });
    }

    const jwtSecret = process.env.JWT_SECRET;

    if (!jwtSecret) {
      console.error("JWT_SECRET is not configured");
      return res.status(500).json({
        success: false,
        message: "Server is not configured correctly",
      });
    }

    const decoded = jwt.verify(token, jwtSecret);

    if (typeof decoded === "string") {
      return res.status(401).json({
        success: false,
        message: "Invalid authentication token",
      });
    }

    const userId = decoded.userId;

    if (typeof userId !== "string") {
      return res.status(401).json({
        success: false,
        message: "Invalid authentication token",
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: BigInt(userId) },
      select: { isActive: true, sessionsValidAfter: true, publicId: true },
    });

    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        message: "User account is inactive or does not exist",
      });
    }

    // The browser's sign-in is one cookie shared by every tab. Each tab says who it thinks is signed in; if the
    // cookie now belongs to someone else (another person signed in on this browser), refuse instead of letting the
    // tab quietly act as that other person. Clients that send no header (scripts, older tabs) are unaffected.
    const claimed = req.headers["x-session-user"];
    if (typeof claimed === "string" && claimed && claimed.toLowerCase() !== user.publicId.toLowerCase()) {
      return res.status(401).json({
        success: false,
        message: "Someone else signed in on this browser, so you were signed out here. Please sign in again.",
      });
    }

    // A password change cuts off every token issued before it (JWT iat is in whole seconds).
    if (user.sessionsValidAfter) {
      const issuedAt = typeof decoded.iat === "number" ? decoded.iat : 0;
      if (issuedAt < Math.floor(user.sessionsValidAfter.getTime() / 1000)) {
        return res.status(401).json({
          success: false,
          message: "Your session has ended. Please sign in again.",
        });
      }
    }

    req.user = {
      userId,
    };

    next();
  } catch {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired authentication token",
    });
  }
}

