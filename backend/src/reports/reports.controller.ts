import type { Response } from "express";
import type { BusinessRequest } from "../auth/business.middleware.js";
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

    const startDate = new Date(`${startValue}T00:00:00.000`);
    const endDate = new Date(`${endValue}T00:00:00.000`);

    if (
      Number.isNaN(startDate.getTime()) ||
      Number.isNaN(endDate.getTime()) ||
      startValue > endValue
    ) {
      return res.status(400).json({
        success: false,
        message: "A valid date range is required",
      });
    }

    const endDateExclusive = new Date(endDate);
    endDateExclusive.setDate(endDateExclusive.getDate() + 1);

    const data = await getBusinessReports(
      req.businessId.toString(),
      {
        startDate,
        endDateExclusive,
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
