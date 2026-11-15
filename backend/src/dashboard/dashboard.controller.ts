import type { NextFunction, Response } from "express";
import type { BusinessRequest } from "../auth/business.middleware.js";
import prisma from "../lib/prisma.js";
import { AppError } from "../lib/errors.js";
import { isValidTimeZone } from "../lib/timezone.js";
import { getDashboard } from "./dashboard.service.js";

export async function getDashboardController(req: BusinessRequest, res: Response, next: NextFunction) {
  try {
    if (!req.businessId) throw new AppError(400, "Business context is required");
    const has = (p: string) => req.permissions?.has(p) ?? false;
    const business = await prisma.business.findUnique({ where: { id: req.businessId }, select: { timezone: true } });
    const timeZone = business?.timezone && isValidTimeZone(business.timezone) ? business.timezone : "Africa/Nairobi";

    const data = await getDashboard({
      businessId: req.businessId,
      userId: BigInt(req.user!.userId),
      timeZone,
      seeAllSales: has("sales.view_all"),
      seeOwnSales: has("sales.view_own"),
      seeStock: has("products.view"),
      seePayables: has("purchases.view"),
    });
    res.status(200).json({
      success: true,
      message: "Dashboard retrieved successfully",
      // Fresh on every load, so the screens follow a role change without signing in again.
      data: { ...data, permissions: Array.from(req.permissions ?? []).sort() },
    });
  } catch (error) {
    next(error);
  }
}
