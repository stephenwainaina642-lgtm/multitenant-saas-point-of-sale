import type { Response } from "express";
import type { BusinessRequest } from "../auth/business.middleware.js";
import {
  getBusinessQuotations,
  getBusinessQuotationById,
  createBusinessQuotation,
} from "./quotation.service.js";

export async function getQuotationsController(
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

    const quotations = await getBusinessQuotations(
      req.businessId.toString()
    );

    return res.status(200).json({
      success: true,
      message: "Quotations retrieved successfully",
      data: quotations,
    });
  } catch (error) {
    console.error("Get quotations error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve quotations",
    });
  }
}

export async function getQuotationByIdController(
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
        message: "Quotation ID is required",
      });
    }

    const quotation = await getBusinessQuotationById(
      req.businessId.toString(),
      id
    );

    return res.status(200).json({
      success: true,
      message: "Quotation retrieved successfully",
      data: quotation,
    });
  } catch (error) {
    console.error("Get quotation error:", error);

    if (
      error instanceof Error &&
      error.message === "Quotation not found"
    ) {
      return res.status(404).json({
        success: false,
        message: "Quotation not found",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve quotation",
    });
  }
}

export async function createQuotationController(
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
      quotationNumber,
      quotationDate,
      expiryDate,
      discount,
      tax,
      status,
      notes,
      items,
    } = req.body;

    const quotation = await createBusinessQuotation(
      req.businessId.toString(),
      {
        quotationNumber: quotationNumber
          ? String(quotationNumber)
          : "",
        items: Array.isArray(items)
          ? items.map((item) => ({
              productId: String(item.productId),
              quantity: Number(item.quantity),
              unitPrice: Number(item.unitPrice),
              ...(item.discount !== undefined && {
                discount: Number(item.discount),
              }),
              ...(item.tax !== undefined && {
                tax: Number(item.tax),
              }),
            }))
          : [],
        ...(customerId !== undefined && {
          customerId: String(customerId),
        }),
        ...(quotationDate !== undefined && {
          quotationDate: String(quotationDate),
        }),
        ...(expiryDate !== undefined && {
          expiryDate: String(expiryDate),
        }),
        ...(discount !== undefined && {
          discount: Number(discount),
        }),
        ...(tax !== undefined && {
          tax: Number(tax),
        }),
        ...(status !== undefined && {
          status: String(status),
        }),
        ...(notes !== undefined && {
          notes: String(notes),
        }),
      }
    );

    return res.status(201).json({
      success: true,
      message: "Quotation created successfully",
      data: quotation,
    });
  } catch (error) {
    console.error("Create quotation error:", error);

    if (
      error instanceof Error &&
      [
        "Quotation number is required",
        "At least one quotation item is required",
        "Invalid quotation date",
        "Invalid expiry date",
        "Invalid quotation discount",
        "Invalid quotation tax",
        "Quotation number already exists",
        "Customer not found",
        "One or more products not found",
        "Item quantity must be greater than zero",
        "Item unit price cannot be negative",
        "Invalid item discount",
        "Invalid item tax",
        "Quotation total cannot be negative",
      ].includes(error.message)
    ) {
      return res.status(
        error.message === "Customer not found" ||
        error.message === "One or more products not found"
          ? 404
          : 400
      ).json({
        success: false,
        message: error.message,
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to create quotation",
    });
  }
}
