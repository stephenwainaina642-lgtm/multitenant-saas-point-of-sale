import type { Response } from "express";
import type { BusinessRequest } from "../auth/business.middleware.js";
import {
  getBusinessInvoices,
  getBusinessInvoiceById,
  createBusinessInvoice,
} from "./invoice.service.js";

export async function getInvoicesController(
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

    const invoices = await getBusinessInvoices(
      req.businessId.toString()
    );

    return res.status(200).json({
      success: true,
      message: "Invoices retrieved successfully",
      data: invoices,
    });
  } catch (error) {
    console.error("Get invoices error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve invoices",
    });
  }
}

export async function getInvoiceByIdController(
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
        message: "Invoice ID is required",
      });
    }

    const invoice = await getBusinessInvoiceById(
      req.businessId.toString(),
      id
    );

    return res.status(200).json({
      success: true,
      message: "Invoice retrieved successfully",
      data: invoice,
    });
  } catch (error) {
    console.error("Get invoice error:", error);

    if (
      error instanceof Error &&
      error.message === "Invoice not found"
    ) {
      return res.status(404).json({
        success: false,
        message: "Invoice not found",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve invoice",
    });
  }
}

export async function createInvoiceController(
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
      invoiceNumber,
      invoiceDate,
      dueDate,
      status,
      notes,
    } = req.body;

    const invoice = await createBusinessInvoice(
      req.businessId.toString(),
      {
        saleId: saleId ? String(saleId) : "",
        invoiceNumber: invoiceNumber
          ? String(invoiceNumber)
          : "",
        ...(invoiceDate !== undefined && {
          invoiceDate: String(invoiceDate),
        }),
        ...(dueDate !== undefined && {
          dueDate: String(dueDate),
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
      message: "Invoice created successfully",
      data: invoice,
    });
  } catch (error) {
    console.error("Create invoice error:", error);

    if (
      error instanceof Error &&
      [
        "Sale ID is required",
        "Invoice number is required",
        "Invalid invoice date",
        "Invalid due date",
        "Invoice number already exists",
        "Sale not found",
        "Sale already has an invoice",
        "Sale has no items",
      ].includes(error.message)
    ) {
      return res.status(
        error.message === "Sale not found"
          ? 404
          : 400
      ).json({
        success: false,
        message: error.message,
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to create invoice",
    });
  }
}
