import type { Response, NextFunction } from "express";
import prisma from "../lib/prisma.js";
import type { AuthenticatedRequest } from "./auth.middleware.js";
import { resolvePermissions } from "./permissions.js";

export type BusinessRequest = AuthenticatedRequest & {
  businessId?: bigint;
  businessRole?: string;
  isBusinessOwner?: boolean;
  permissions?: Set<string>;
};

export async function requireBusinessAccess(
  req: BusinessRequest,
  res: Response,
  next: NextFunction
) {
  try {
    if (!req.user?.userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const businessIdHeader = req.headers["x-business-id"];

    if (!businessIdHeader || Array.isArray(businessIdHeader)) {
      return res.status(400).json({
        success: false,
        message: "X-Business-ID header is required",
      });
    }

    if (!/^[1-9]\d*$/.test(businessIdHeader)) {
      return res.status(400).json({
        success: false,
        message: "Invalid business ID",
      });
    }

    const businessId = BigInt(businessIdHeader);
    const userId = BigInt(req.user.userId);

    const membership = await prisma.businessUser.findFirst({
      where: {
        userId,
        businessId,
        isActive: true,
        business: {
          isActive: true,
        },
      },
      include: {
        role: true,
        business: {
          select: {
            ownerUserId: true,
          },
        },
      },
    });

    if (!membership) {
      return res.status(403).json({
        success: false,
        message: "You do not have access to this business",
      });
    }

    req.businessId = membership.businessId;
    req.businessRole = membership.role.name;
    req.isBusinessOwner = membership.business.ownerUserId === userId;
    req.permissions = resolvePermissions(
      membership.role.name,
      membership.role.permissions,
      req.isBusinessOwner
    );

    next();
  } catch (error) {
    if (error instanceof SyntaxError) {
      return res.status(400).json({
        success: false,
        message: "Invalid business ID",
      });
    }

    console.error("Business access error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to verify business access",
    });
  }
}