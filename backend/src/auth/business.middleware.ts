import type { Response, NextFunction } from "express";
import prisma from "../lib/prisma.js";
import type { AuthenticatedRequest } from "./auth.middleware.js";
import { denialMessage } from "../business/business-context.service.js";
import { resolvePermissions } from "./permissions.js";

export type BusinessRequest = AuthenticatedRequest & {
  businessId?: bigint;
  /** The branch this request works in (stock, sales, shifts are recorded against it). */
  branchId?: bigint;
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
          approvalStatus: "approved",
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
        message: await denialMessage(userId, businessId),
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

    // Which branch? Staff assigned to a branch stay in it; people with "branches.all" may pick one
    // with X-Branch-ID; everyone else without an assignment works in the Main branch.
    const branchHeader = req.headers["x-branch-id"];
    const requested =
      typeof branchHeader === "string" && /^[1-9]\d*$/.test(branchHeader) ? BigInt(branchHeader) : null;
    const canPick = req.permissions.has("branches.all");
    const wanted =
      membership.branchId && !canPick ? membership.branchId : requested ?? membership.branchId;
    const branch = wanted
      ? await prisma.branch.findFirst({ where: { id: wanted, businessId, isActive: true } })
      : await prisma.branch.findFirst({ where: { businessId, isMain: true } });
    if (!branch) {
      return res.status(403).json({ success: false, message: "That branch is not available" });
    }
    req.branchId = branch.id;

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