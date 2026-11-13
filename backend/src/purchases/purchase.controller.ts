import { AppError } from "../lib/errors.js";
import type { Response } from "express";
import type { BusinessRequest } from "../auth/business.middleware.js";
import {
  getBusinessPurchases,
  createBusinessPurchase,
} from "./purchase.service.js";

export async function getPurchasesController(
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

    const purchases = await getBusinessPurchases(
      req.businessId.toString()
    );

    return res.status(200).json({
      success: true,
      message: "Purchases retrieved successfully",
      data: purchases,
    });
  } catch (error) {
    console.error("Get purchases error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve purchases",
    });
  }
}

export async function createPurchaseController(
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
      supplierId,
      invoiceNumber,
      discount,
      tax,
      amountPaid,
      notes,
      items,
    } = req.body;

    if (!supplierId) {
      return res.status(400).json({
        success: false,
        message: "Supplier ID is required",
      });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: "At least one purchase item is required",
      });
    }

    const purchase = await createBusinessPurchase(
      req.businessId.toString(),
      {
        supplierId: String(supplierId),

        ...(invoiceNumber !== undefined && {
          invoiceNumber: String(invoiceNumber),
        }),

        ...(discount !== undefined && {
          discount: Number(discount),
        }),

        ...(tax !== undefined && {
          tax: Number(tax),
        }),

        ...(amountPaid !== undefined && {
          amountPaid: Number(amountPaid),
        }),

        ...(notes !== undefined && {
          notes: String(notes),
        }),

        items: items.map((item: {
          productId: string | number;
          quantity: string | number;
          unitCost: string | number;
          discount?: string | number;
          tax?: string | number;
        }) => ({
          productId: String(item.productId),
          quantity: Number(item.quantity),
          unitCost: Number(item.unitCost),

          ...(item.discount !== undefined && {
            discount: Number(item.discount),
          }),

          ...(item.tax !== undefined && {
            tax: Number(item.tax),
          }),
        })),
      }
    );

    return res.status(201).json({
      success: true,
      message: "Purchase created successfully",
      data: purchase,
    });
  } catch (error) {
    if (error instanceof AppError) {
      return res.status(error.status).json({
        success: false,
        message: error.message,
      });
    }

    console.error("Create purchase error:", error);

    if (
      error instanceof Error &&
      error.message === "Supplier not found"
    ) {
      return res.status(404).json({
        success: false,
        message: "Supplier not found",
      });
    }

    if (
      error instanceof Error &&
      error.message.startsWith("Product not found:")
    ) {
      return res.status(404).json({
        success: false,
        message: error.message,
      });
    }

    if (
      error instanceof Error &&
      [
        "At least one purchase item is required",
        "Quantity must be greater than zero",
        "Unit cost cannot be negative",
        "Discount cannot be negative",
        "Tax cannot be negative",
        "Purchase discount cannot be negative",
        "Purchase tax cannot be negative",
        "Amount paid cannot be negative",
        "Purchase total cannot be negative",
        "Amount paid cannot exceed purchase total",
        "Item total cannot be negative",
      ].includes(error.message)
    ) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to create purchase",
    });
  }
}
