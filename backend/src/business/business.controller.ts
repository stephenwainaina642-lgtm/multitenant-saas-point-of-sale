import type { Response } from "express";
import type { BusinessRequest } from "../auth/business.middleware.js";
import { getUserBusinesses } from "./business.service.js";

export async function getBusinessesController(
  req: BusinessRequest,
  res: Response
) {
  try {
    if (!req.user?.userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const businesses = await getUserBusinesses(req.user.userId);

    return res.status(200).json({
      success: true,
      message: "Businesses retrieved successfully",
      data: businesses,
    });
  } catch (error) {
    console.error("Get businesses error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve businesses",
    });
  }
}