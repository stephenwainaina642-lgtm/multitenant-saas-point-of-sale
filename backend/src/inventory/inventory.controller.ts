import type { Response } from "express";
import type { BusinessRequest } from "../auth/business.middleware.js";
import {
  getBusinessInventoryMovements,
  createInventoryMovement,
} from "./inventory.service.js";

export async function getInventoryController(
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

    const movements = await getBusinessInventoryMovements(
      req.businessId.toString()
    );

    return res.status(200).json({
      success: true,
      message: "Inventory movements retrieved successfully",
      data: movements,
    });
  } catch (error) {
    console.error("Get inventory error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve inventory movements",
    });
  }
}

export async function createInventoryController(
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

    const {
      productId,
      type,
      quantity,
      reference,
      notes,
    } = req.body;

    if (!productId) {
      return res.status(400).json({
        success: false,
        message: "Product ID is required",
      });
    }

    if (!type) {
      return res.status(400).json({
        success: false,
        message: "Movement type is required",
      });
    }

    if (quantity === undefined) {
      return res.status(400).json({
        success: false,
        message: "Quantity is required",
      });
    }

    const parsedQuantity = Number(quantity);

    if (!Number.isFinite(parsedQuantity) || parsedQuantity < 0) {
      return res.status(400).json({
        success: false,
        message: "Quantity must not be negative",
      });
    }

    const movementType = String(type).toUpperCase();

    if (!["IN", "OUT", "ADJUSTMENT"].includes(movementType)) {
      return res.status(400).json({
        success: false,
        message: "Invalid movement type. Use IN, OUT, or ADJUSTMENT",
      });
    }

    if (movementType !== "ADJUSTMENT" && parsedQuantity === 0) {
      return res.status(400).json({
        success: false,
        message: "Quantity must be greater than zero for stock IN or OUT",
      });
    }

    const result = await createInventoryMovement(
      req.businessId.toString(),
      {
        productId: String(productId),
        type: movementType,
        quantity: parsedQuantity,

        ...(reference !== undefined && {
          reference: String(reference),
        }),

        ...(notes !== undefined && {
          notes: String(notes),
        }),
      }
    );

    return res.status(201).json({
      success: true,
      message: "Inventory movement created successfully",
      data: result,
    });
  } catch (error) {
    console.error("Create inventory error:", error);

    if (
      error instanceof Error &&
      error.message === "Product not found"
    ) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    if (
      error instanceof Error &&
      error.message === "Insufficient stock"
    ) {
      return res.status(400).json({
        success: false,
        message: "Insufficient stock",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to create inventory movement",
    });
  }
}
