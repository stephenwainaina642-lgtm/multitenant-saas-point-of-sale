import type { Response, NextFunction } from "express";
import prisma from "../lib/prisma.js";
import type { AuthenticatedRequest } from "./auth.middleware.js";
import { denialMessage } from "../business/business-context.service.js";
import { resolvePermissions } from "./permissions.js";
import { isPublicId } from "../lib/public-id.js";
import { MODULE_INFO, moduleError, moduleForRequest, type ModuleName } from "../lib/packages.js";

export type BusinessRequest = AuthenticatedRequest & {
  businessId?: bigint;
  /** The branch this request works in (stock, sales, shifts are recorded against it). */
  branchId?: bigint;
  businessRole?: string;
  isBusinessOwner?: boolean;
  permissions?: Set<string>;
  /** Optional modules switched on for this business (lib/packages.ts). */
  businessModules?: string[];
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

    // The header carries the business's public UUID. A plain number is still accepted on this header only,
    // so tabs and offline-queued sales that saved one before this change keep working; the membership check
    // below applies either way, so nothing extra is exposed.
    let businessId: bigint;
    if (isPublicId(businessIdHeader)) {
      const found = await prisma.business.findFirst({ where: { publicId: businessIdHeader }, select: { id: true } });
      businessId = found?.id ?? -1n; // unknown here: no membership will match, so it is refused below
    } else if (/^[1-9]\d{0,17}$/.test(businessIdHeader)) {
      businessId = BigInt(businessIdHeader);
    } else {
      return res.status(400).json({
        success: false,
        message: "Invalid business ID",
      });
    }
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
            modules: true,
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

    req.businessModules = membership.business.modules;
    // Switched-off modules are refused here, for every route of that feature, not just hidden in the menu.
    const needed = moduleForRequest(req.baseUrl, req.path);
    if (needed && !membership.business.modules.includes(needed)) return moduleError(res, MODULE_INFO[needed as ModuleName].label);

    // Which branch? Staff assigned to a branch stay in it; people with "branches.all" may pick one
    // with X-Branch-ID; everyone else without an assignment works in the Main branch.
    const branchHeader = req.headers["x-branch-id"];
    // The header carries the branch's public UUID. A plain number is still accepted here only so that
    // tills that saved one before this change (and sales queued offline with one) keep working; the
    // branch is checked against what this user may use either way, so nothing extra is exposed.
    let requested: bigint | null = null;
    if (typeof branchHeader === "string") {
      if (isPublicId(branchHeader)) {
        requested = (await prisma.branch.findFirst({ where: { publicId: branchHeader, businessId }, select: { id: true } }))?.id ?? -1n; // no such branch here: refused below (-1n, because 0n is falsy)
      } else if (/^[1-9]\d{0,17}$/.test(branchHeader)) {
        requested = BigInt(branchHeader);
      }
    }
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