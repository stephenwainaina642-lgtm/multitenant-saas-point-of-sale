import type { Response } from "express";
import { isValidTimeZone } from "../lib/timezone.js";
import type { BusinessRequest } from "../auth/business.middleware.js";
import {
  getUserBusinesses,
  getBusinessProfile,
  updateBusinessProfile,
  type BusinessProfileUpdate,
} from "./business.service.js";

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

export async function getCurrentBusinessController(
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

    const business = await getBusinessProfile(req.businessId);

    if (!business) {
      return res.status(404).json({
        success: false,
        message: "Business not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Business profile retrieved successfully",
      data: business,
    });
  } catch (error) {
    console.error("Get business profile error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve business profile",
    });
  }
}

export async function updateCurrentBusinessController(
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
if (!req.isBusinessOwner) {
      return res.status(403).json({
        success: false,
        message: "Only the business owner can update business settings",
      });
    }

    if (
      !req.body ||
      typeof req.body !== "object" ||
      Array.isArray(req.body)
    ) {
      return res.status(400).json({
        success: false,
        message: "A valid business profile is required",
      });
    }

    const allowedFields = [
      "name",
      "businessType",
      "email",
      "phone",
      "address",
      "taxPin",
      "vatRegistered",
      "vatRate",
      "currency",
      "timezone",
    ];

    const unknownFields = Object.keys(req.body).filter(
      (field) => !allowedFields.includes(field)
    );

    if (unknownFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: "The request contains unsupported business fields",
      });
    }

    const data: BusinessProfileUpdate = {};

    const requiredFields = [
      "name",
      "businessType",
      "currency",
      "timezone",
    ] as const;

    for (const field of requiredFields) {
      if (req.body[field] !== undefined) {
        if (
          typeof req.body[field] !== "string" ||
          !req.body[field].trim()
        ) {
          return res.status(400).json({
            success: false,
            message: `${field} must be a non-empty string`,
          });
        }

        data[field] = req.body[field].trim();
      }
    }

    const optionalFields = [
      "email",
      "phone",
      "address",
      "taxPin",
    ] as const;

    for (const field of optionalFields) {
      if (req.body[field] !== undefined) {
        const value = req.body[field];

        if (value !== null && typeof value !== "string") {
          return res.status(400).json({
            success: false,
            message: `${field} must be a string or null`,
          });
        }

        data[field] =
          typeof value === "string" && value.trim()
            ? value.trim()
            : null;
      }
    }

    const limits: Record<string, number> = {
      name: 255,
      businessType: 100,
      email: 255,
      phone: 50,
      currency: 10,
      timezone: 100,
    };

    for (const [field, value] of Object.entries(data)) {
      if (
        typeof value === "string" &&
        limits[field] &&
        value.length > limits[field]
      ) {
        return res.status(400).json({
          success: false,
          message: `${field} exceeds the maximum length of ${limits[field]} characters`,
        });
      }
    }

    if (req.body.vatRegistered !== undefined) {
      if (typeof req.body.vatRegistered !== "boolean") {
        return res.status(400).json({ success: false, message: "vatRegistered must be true or false" });
      }
      data.vatRegistered = req.body.vatRegistered;
    }

    if (req.body.vatRate !== undefined) {
      const raw = String(req.body.vatRate).trim();
      if (!/^\d{1,3}(\.\d{1,2})?$/.test(raw) || Number(raw) > 100) {
        return res.status(400).json({
          success: false,
          message: "VAT rate must be a percentage between 0 and 100 with at most 2 decimals",
        });
      }
      data.vatRate = Number(raw).toFixed(2);
    }

    if (data.vatRegistered !== undefined || data.taxPin !== undefined) {
      const stored = await getBusinessProfile(req.businessId);
      const registered = data.vatRegistered ?? stored?.vatRegistered ?? false;
      const pin = data.taxPin !== undefined ? data.taxPin : stored?.taxPin;
      if (registered && !pin) {
        return res.status(400).json({
          success: false,
          message: "A VAT-registered business needs its KRA PIN",
        });
      }
    }

    if (data.taxPin) {
      data.taxPin = data.taxPin.toUpperCase().replace(/\s+/g, "");
      if (!/^[A-Z][0-9]{9}[A-Z]$/.test(data.taxPin)) {
        return res.status(400).json({
          success: false,
          message: "KRA PIN must be a letter, nine digits and a letter, e.g. A001234567Z",
        });
      }
    }

    if (data.timezone && !isValidTimeZone(data.timezone)) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid time zone, e.g. Africa/Nairobi",
      });
    }

    if (
      data.email &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)
    ) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid email address",
      });
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No business profile changes were provided",
      });
    }

    const business = await updateBusinessProfile(
      req.businessId,
      data
    );

    return res.status(200).json({
      success: true,
      message: "Business profile updated successfully",
      data: business,
    });
  } catch (error) {
    console.error("Update business profile error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update business profile",
    });
  }
}
