import type { Response } from "express";
import type { BusinessRequest } from "../auth/business.middleware.js";
import prisma from "../lib/prisma.js";
import { isValidTimeZone, nextDay, startOfDay } from "../lib/timezone.js";
import { getBusinessReports } from "./reports.service.js";
import { getVatReport } from "./vat-report.service.js";

type Range = { startDate: Date; endDateExclusive: Date; timeZone: string };

/** Reads and validates ?startDate=&endDate= (business-local calendar days). Sends the error itself and returns null. */
async function readRange(req: BusinessRequest, res: Response): Promise<Range | null> {
  const startValue = req.query.startDate;
  const endValue = req.query.endDate;

  if (typeof startValue !== "string" || typeof endValue !== "string") {
    res.status(400).json({ success: false, message: "Start date and end date are required" });
    return null;
  }

  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  if (!DATE.test(startValue) || !DATE.test(endValue) || startValue > endValue) {
    res.status(400).json({ success: false, message: "A valid date range is required" });
    return null;
  }

  const business = await prisma.business.findUnique({
    where: { id: req.businessId! },
    select: { timezone: true },
  });
  const timeZone =
    business?.timezone && isValidTimeZone(business.timezone) ? business.timezone : "Africa/Nairobi";

  try {
    return {
      startDate: startOfDay(startValue, timeZone),
      endDateExclusive: startOfDay(nextDay(endValue), timeZone),
      timeZone,
    };
  } catch {
    res.status(400).json({ success: false, message: "A valid date range is required" });
    return null;
  }
}

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

    const range = await readRange(req, res);
    if (!range) return;

    const data = await getBusinessReports(req.businessId.toString(), range);

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

export async function getVatReportController(req: BusinessRequest, res: Response) {
  try {
    if (!req.businessId) {
      return res.status(400).json({ success: false, message: "Business context is required" });
    }
    const range = await readRange(req, res);
    if (!range) return;
    const data = await getVatReport(req.businessId.toString(), range);
    return res.status(200).json({ success: true, message: "VAT report retrieved successfully", data });
  } catch (error) {
    console.error("Get VAT report error:", error);
    return res.status(500).json({ success: false, message: "Failed to retrieve the VAT report" });
  }
}
