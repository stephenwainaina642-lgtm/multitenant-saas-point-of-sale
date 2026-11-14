import type { Response } from "express";
import type { BusinessRequest } from "../auth/business.middleware.js";
import { AppError } from "../lib/errors.js";
import {
  getBusinessSales,
  getBusinessSaleById,
  createBusinessSale,
} from "./sale.service.js";

export async function getSalesController(
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

    const sales = await getBusinessSales(
      req.businessId.toString(),
      req.user!.userId,
      req.permissions?.has("sales.view_all") ?? false
    );

    return res.status(200).json({
      success: true,
      message: "Sales retrieved successfully",
      data: sales,
    });
  } catch (error) {
    console.error("Get sales error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve sales",
    });
  }
}

export async function getSaleByIdController(
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

    const { id } = req.params;

    if (!id || Array.isArray(id)) {
      return res.status(400).json({
        success: false,
        message: "Sale ID is required",
      });
    }

    const sale = await getBusinessSaleById(
      req.businessId.toString(),
      id,
      req.user!.userId,
      req.permissions?.has("sales.view_all") ?? false
    );

    return res.status(200).json({
      success: true,
      message: "Sale retrieved successfully",
      data: sale,
    });
  } catch (error) {
    console.error("Get sale error:", error);

    if (
      error instanceof Error &&
      error.message === "Sale not found"
    ) {
      return res.status(404).json({
        success: false,
        message: "Sale not found",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve sale",
    });
  }
}

export async function createSaleController(
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
      customerId,
      discount,
      tax,
      amountPaid,
      paymentMethod,
      notes,
      items,
    } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: "At least one sale item is required",
      });
    }

    const sale = await createBusinessSale(
      req.businessId.toString(),
      req.user!.userId,
      {
        ...(customerId !== undefined &&
          customerId !== null &&
          customerId !== "" && {
            customerId: String(customerId),
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

        ...(paymentMethod !== undefined && {
          paymentMethod: String(paymentMethod),
        }),

        ...(notes !== undefined && {
          notes: String(notes),
        }),

        items: items.map((item: {
          productId: string | number;
          quantity: string | number;
          unitPrice: string | number;
          discount?: string | number;
          tax?: string | number;
        }) => ({
          productId: String(item.productId),
          quantity: Number(item.quantity),
          unitPrice: Number(item.unitPrice),

          ...(item.discount !== undefined && {
            discount: Number(item.discount),
          }),

          ...(item.tax !== undefined && {
            tax: Number(item.tax),
          }),
        })),
      },
      {
        idempotencyKey: Array.isArray(req.headers["idempotency-key"])
          ? undefined
          : req.headers["idempotency-key"],
      }
    );

    return res.status(201).json({
      success: true,
      message: "Sale created successfully",
      data: sale,
    });
  } catch (error) {
    if (error instanceof AppError) {
      return res.status(error.status).json({
        success: false,
        message: error.message,
      });
    }

    console.error("Create sale error:", error);

    if (
      error instanceof Error &&
      error.message === "Customer not found"
    ) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
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
      error.message.startsWith("Insufficient stock for product:")
    ) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }

    if (
      error instanceof Error &&
      error.message.startsWith("Sale price does not match the saved selling price for:")
    ) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }

    if (
      error instanceof Error &&
      [
        "At least one sale item is required",
        "Quantity must be greater than zero",
        "Quantity must be a whole number",
        "Unit price cannot be negative",
        "Discount cannot be negative",
        "Tax cannot be negative",
        "Sale discount cannot be negative",
        "Sale tax cannot be negative",
        "Amount paid cannot be negative",
        "Payment method is required when an initial payment is made",
        "Sale total cannot be negative",
        "Amount paid cannot exceed sale total",
        "Item total cannot be negative",
        "Insufficient stock",
      ].includes(error.message)
    ) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to create sale",
    });
  }
}
