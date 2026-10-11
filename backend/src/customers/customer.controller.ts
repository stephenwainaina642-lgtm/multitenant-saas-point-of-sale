import type { Response } from "express";
import type { BusinessRequest } from "../auth/business.middleware.js";
import {
  getBusinessCustomers,
  createBusinessCustomer,
  updateBusinessCustomer,
  deleteBusinessCustomer,
} from "./customer.service.js";

export async function getCustomersController(
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

    const customers = await getBusinessCustomers(
      req.businessId.toString()
    );

    return res.status(200).json({
      success: true,
      message: "Customers retrieved successfully",
      data: customers,
    });
  } catch (error) {
    console.error("Get customers error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve customers",
    });
  }
}

export async function createCustomerController(
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
        message: "Customer name is required",
      });
    }

    const customer = await createBusinessCustomer(
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
      message: "Customer created successfully",
      data: customer,
    });
  } catch (error) {
    console.error("Create customer error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to create customer",
    });
  }
}

export async function updateCustomerController(
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
        message: "Customer ID is required",
      });
    }

    const {
      name,
      phone,
      email,
      address,
      notes,
    } = req.body;

    const customerData: {
      name?: string;
      phone?: string;
      email?: string;
      address?: string;
      notes?: string;
    } = {};

    if (name !== undefined) {
      customerData.name = String(name);
    }

    if (phone !== undefined) {
      customerData.phone = String(phone);
    }

    if (email !== undefined) {
      customerData.email = String(email);
    }

    if (address !== undefined) {
      customerData.address = String(address);
    }

    if (notes !== undefined) {
      customerData.notes = String(notes);
    }

    if (Object.keys(customerData).length === 0) {
      return res.status(400).json({
        success: false,
        message: "At least one field is required to update",
      });
    }

    const customer = await updateBusinessCustomer(
      req.businessId.toString(),
      id,
      customerData
    );

    return res.status(200).json({
      success: true,
      message: "Customer updated successfully",
      data: customer,
    });
  } catch (error) {
    console.error("Update customer error:", error);

    if (
      error instanceof Error &&
      error.message === "Customer not found"
    ) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to update customer",
    });
  }
}

export async function deleteCustomerController(
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
        message: "Customer ID is required",
      });
    }

    const customer = await deleteBusinessCustomer(
      req.businessId.toString(),
      id
    );

    return res.status(200).json({
      success: true,
      message: "Customer deleted successfully",
      data: customer,
    });
  } catch (error) {
    console.error("Delete customer error:", error);

    if (
      error instanceof Error &&
      error.message === "Customer not found"
    ) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to delete customer",
    });
  }
}
