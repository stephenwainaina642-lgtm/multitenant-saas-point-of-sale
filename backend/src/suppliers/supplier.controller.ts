import type { Response } from "express";
import type { BusinessRequest } from "../auth/business.middleware.js";
import {
  getBusinessSuppliers,
  createBusinessSupplier,
  updateBusinessSupplier,
  deleteBusinessSupplier,
} from "./supplier.service.js";

export async function getSuppliersController(
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

    const suppliers = await getBusinessSuppliers(
      req.businessId.toString()
    );

    return res.status(200).json({
      success: true,
      message: "Suppliers retrieved successfully",
      data: suppliers,
    });
  } catch (error) {
    console.error("Get suppliers error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve suppliers",
    });
  }
}

export async function createSupplierController(
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
      name,
      phone,
      email,
      address,
      notes,
    } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "Supplier name is required",
      });
    }

    const supplier = await createBusinessSupplier(
      req.businessId.toString(),
      {
        name: String(name),

        ...(phone !== undefined && {
          phone: String(phone),
        }),

        ...(email !== undefined && {
          email: String(email),
        }),

        ...(address !== undefined && {
          address: String(address),
        }),

        ...(notes !== undefined && {
          notes: String(notes),
        }),
      }
    );

    return res.status(201).json({
      success: true,
      message: "Supplier created successfully",
      data: supplier,
    });
  } catch (error) {
    console.error("Create supplier error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to create supplier",
    });
  }
}

export async function updateSupplierController(
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
        message: "Supplier ID is required",
      });
    }

    const {
      name,
      phone,
      email,
      address,
      notes,
    } = req.body;

    const supplierData: {
      name?: string;
      phone?: string;
      email?: string;
      address?: string;
      notes?: string;
    } = {};

    if (name !== undefined) {
      supplierData.name = String(name);
    }

    if (phone !== undefined) {
      supplierData.phone = String(phone);
    }

    if (email !== undefined) {
      supplierData.email = String(email);
    }

    if (address !== undefined) {
      supplierData.address = String(address);
    }

    if (notes !== undefined) {
      supplierData.notes = String(notes);
    }

    if (Object.keys(supplierData).length === 0) {
      return res.status(400).json({
        success: false,
        message: "At least one field is required to update",
      });
    }

    const supplier = await updateBusinessSupplier(
      req.businessId.toString(),
      id,
      supplierData
    );

    return res.status(200).json({
      success: true,
      message: "Supplier updated successfully",
      data: supplier,
    });
  } catch (error) {
    console.error("Update supplier error:", error);

    if (
      error instanceof Error &&
      error.message === "Supplier not found"
    ) {
      return res.status(404).json({
        success: false,
        message: "Supplier not found",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to update supplier",
    });
  }
}

export async function deleteSupplierController(
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
        message: "Supplier ID is required",
      });
    }

    const supplier = await deleteBusinessSupplier(
      req.businessId.toString(),
      id
    );

    return res.status(200).json({
      success: true,
      message: "Supplier deleted successfully",
      data: supplier,
    });
  } catch (error) {
    console.error("Delete supplier error:", error);

    if (
      error instanceof Error &&
      error.message === "Supplier not found"
    ) {
      return res.status(404).json({
        success: false,
        message: "Supplier not found",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to delete supplier",
    });
  }
}
