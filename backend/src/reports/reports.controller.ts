import type { Response } from "express";
import type { BusinessRequest } from "../auth/business.middleware.js";
import prisma from "../lib/prisma.js";
import { isValidTimeZone, nextDay, startOfDay } from "../lib/timezone.js";
import { getBusinessReports } from "./reports.service.js";

export async function getReportsController(
  req: BusinessRequest,
  res: Response
) {
  try {
    if (!req.businessId) {
      return res.status(400).json({
        success: false,
        message: "Business context is required",
      });
    }

    const startValue = req.query.startDate;
    const endValue = req.query.endDate;

    if (
      typeof startValue !== "string" ||
      typeof endValue !== "string"
    ) {
      return res.status(400).json({
        success: false,
        message: "Start date and end date are required",
      });
    }

    const DATE = /^\d{4}-\d{2}-\d{2}$/;
    if (!DATE.test(startValue) || !DATE.test(endValue) || startValue > endValue) {
      return res.status(400).json({
        success: false,
        message: "A valid date range is required",
      });
    }

    const business = await prisma.business.findUnique({
      where: { id: req.businessId },
      select: { timezone: true },
    });
    const timeZone =
      business?.timezone && isValidTimeZone(business.timezone) ? business.timezone : "Africa/Nairobi";

    let startDate: Date;
    let endDateExclusive: Date;
    try {
      startDate = startOfDay(startValue, timeZone);
      endDateExclusive = startOfDay(nextDay(endValue), timeZone);
    } catch {
      return res.status(400).json({
        success: false,
        message: "A valid date range is required",
      });
    }

    const data = await getBusinessReports(
      req.businessId.toString(),
      {
        startDate,
        endDateExclusive,
        timeZone,
      }
    );

    return res.status(200).json({
      success: true,
      message: "Reports retrieved successfully",
      data,
    });
  } catch (error) {
    console.error("Get reports error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve reports",
    });
  }
}
