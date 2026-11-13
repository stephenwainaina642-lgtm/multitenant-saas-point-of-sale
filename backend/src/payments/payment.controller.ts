import { AppError } from "../lib/errors.js";
import type { Response } from "express";
import type { BusinessRequest } from "../auth/business.middleware.js";
import {
  getBusinessPayments,
  createBusinessPayment,
} from "./payment.service.js";

export async function getPaymentsController(
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

    const payments = await getBusinessPayments(
      req.businessId.toString()
    );

    return res.status(200).json({
      success: true,
      message: "Payments retrieved successfully",
      data: payments,
    });
  } catch (error) {
    console.error("Get payments error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve payments",
    });
  }
}

export async function createPaymentController(
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
      saleId,
      amount,
      method,
      reference,
      notes,
    } = req.body;

    if (!saleId) {
      return res.status(400).json({
        success: false,
        message: "Sale ID is required",
      });
    }

    const payment = await createBusinessPayment(
      req.businessId.toString(),
      {
        saleId: String(saleId),
        idempotencyKey: Array.isArray(req.headers["idempotency-key"])
          ? undefined
          : req.headers["idempotency-key"],
        amount: Number(amount),
        method: method ? String(method) : "",
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
      message: "Payment created successfully",
      data: payment,
    });
  } catch (error) {
    if (error instanceof AppError) {
      return res.status(error.status).json({
        success: false,
        message: error.message,
      });
    }

    console.error("Create payment error:", error);

    if (
      error instanceof Error &&
      [
        "Sale not found",
        "Payment amount must be greater than zero",
        "Payment method is required",
        "Sale has no outstanding balance",
        "Payment amount cannot exceed outstanding balance",
      ].includes(error.message)
    ) {
      return res.status(
        error.message === "Sale not found" ? 404 : 400
      ).json({
        success: false,
        message: error.message,
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to create payment",
    });
  }
}
