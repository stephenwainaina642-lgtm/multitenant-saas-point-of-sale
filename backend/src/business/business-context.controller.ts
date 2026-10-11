import type { Request, Response } from "express";
import { verifyBusinessAccess } from "./business-context.service.js";

type AuthenticatedRequest = Request & {
  user?: {
    userId: string;
  };
};

export async function selectBusinessController(
  req: AuthenticatedRequest,
  res: Response
) {
  try {
    if (!req.user?.userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const { businessId } = req.body;

    if (!businessId) {
      return res.status(400).json({
        success: false,
        message: "Business ID is required",
      });
    }

    const business = await verifyBusinessAccess(
      req.user.userId,
      String(businessId)
    );

    return res.status(200).json({
      success: true,
      message: "Business selected successfully",
      data: business,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to select business";

    return res.status(403).json({
      success: false,
      message,
    });
  }
}