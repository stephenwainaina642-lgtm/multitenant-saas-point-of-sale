import type { Response } from "express";
import type { BusinessRequest } from "../auth/business.middleware.js";
import {
  getBusinessProducts,
  createBusinessProduct,
  updateBusinessProduct,
  deleteBusinessProduct,
} from "./product.service.js";

function getDuplicateField(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;

  const err = error as {
    code?: string;
    meta?: { target?: unknown };
  };

  if (err.code !== "P2002") return null;

  const target = Array.isArray(err.meta?.target)
    ? err.meta.target.join(" ").toLowerCase()
    : String(err.meta?.target ?? "").toLowerCase();

  if (target.includes("sku")) return "SKU";
  if (target.includes("barcode")) return "barcode";

  return "SKU or barcode";
}

function sendProductError(
  res: Response,
  error: unknown,
  operation: "create" | "update"
) {
  const duplicateField = getDuplicateField(error);

  if (duplicateField) {
    return res.status(409).json({
      success: false,
      message: `A product with this ${duplicateField} already exists in this business`,
    });
  }

  if (error instanceof Error && error.message === "Product not found") {
    return res.status(404).json({
      success: false,
      message: "Product not found",
    });
  }

  console.error(`${operation === "create" ? "Create" : "Update"} product error:`, error);

  return res.status(500).json({
    success: false,
    message: `Failed to ${operation} product`,
  });
}

function optionalText(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (value === null) return "";
  return String(value).trim();
}

export async function getProductsController(
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

    const products = await getBusinessProducts(req.businessId.toString());

    return res.status(200).json({
      success: true,
      message: "Products retrieved successfully",
      data: products,
    });
  } catch (error) {
    console.error("Get products error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve products",
    });
  }
}

export async function createProductController(
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
      sku,
      barcode,
      description,
      costPrice,
      sellingPrice,
      stockQuantity,
      minimumStock,
      unitOfMeasure,
    } = req.body;

    const parsedName = typeof name === "string" ? name.trim() : "";

    if (!parsedName) {
      return res.status(400).json({
        success: false,
        message: "Product name is required",
      });
    }

    if (costPrice === undefined || sellingPrice === undefined) {
      return res.status(400).json({
        success: false,
        message: "Cost price and selling price are required",
      });
    }

    const parsedCostPrice = Number(costPrice);
    const parsedSellingPrice = Number(sellingPrice);

    if (
      !Number.isFinite(parsedCostPrice) ||
      !Number.isFinite(parsedSellingPrice) ||
      parsedCostPrice < 0 ||
      parsedSellingPrice < 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Cost price and selling price must be valid non-negative numbers",
      });
    }

    const parsedStockQuantity =
      stockQuantity === undefined ? 0 : Number(stockQuantity);

    if (
      !Number.isFinite(parsedStockQuantity) ||
      parsedStockQuantity < 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Opening stock must be a valid non-negative number",
      });
    }

    const parsedMinimumStock =
      minimumStock === undefined ? 0 : Number(minimumStock);

    if (
      !Number.isFinite(parsedMinimumStock) ||
      parsedMinimumStock < 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Minimum stock must be a valid non-negative number",
      });
    }

    const parsedUnitOfMeasure =
      unitOfMeasure === undefined ? "piece" : String(unitOfMeasure).trim();

    if (!parsedUnitOfMeasure || parsedUnitOfMeasure.length > 50) {
      return res.status(400).json({
        success: false,
        message: "Unit of measure is required and must not exceed 50 characters",
      });
    }

    const parsedSku = optionalText(sku);
    const parsedBarcode = optionalText(barcode);
    const parsedDescription = optionalText(description);

    if (parsedSku && parsedSku.length > 100) {
      return res.status(400).json({
        success: false,
        message: "SKU must not exceed 100 characters",
      });
    }

    if (parsedBarcode && parsedBarcode.length > 100) {
      return res.status(400).json({
        success: false,
        message: "Barcode must not exceed 100 characters",
      });
    }

    const product = await createBusinessProduct(
      req.businessId.toString(),
      {
        name: parsedName,
        costPrice: parsedCostPrice,
        sellingPrice: parsedSellingPrice,
        stockQuantity: parsedStockQuantity,
        minimumStock: parsedMinimumStock,
        unitOfMeasure: parsedUnitOfMeasure,
        ...(parsedSku !== undefined && parsedSku !== "" && { sku: parsedSku }),
        ...(parsedBarcode !== undefined && parsedBarcode !== "" && {
          barcode: parsedBarcode,
        }),
        ...(parsedDescription !== undefined && {
          description: parsedDescription,
        }),
      }
    );

    return res.status(201).json({
      success: true,
      message: "Product created successfully",
      data: product,
    });
  } catch (error) {
    return sendProductError(res, error, "create");
  }
}

export async function updateProductController(
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

    if (!id || Array.isArray(id) || !/^\d+$/.test(id) || id === "0") {
      return res.status(400).json({
        success: false,
        message: "A valid product ID is required",
      });
    }

    const {
      name,
      sku,
      barcode,
      description,
      costPrice,
      sellingPrice,
      minimumStock,
      unitOfMeasure,
    } = req.body;

    const productData: {
      name?: string;
      sku?: string | null;
      barcode?: string | null;
      description?: string;
      costPrice?: number;
      sellingPrice?: number;
      minimumStock?: number;
      unitOfMeasure?: string;
    } = {};

    if (name !== undefined) {
      const parsedName = typeof name === "string" ? name.trim() : "";

      if (!parsedName) {
        return res.status(400).json({
          success: false,
          message: "Product name cannot be empty",
        });
      }

      productData.name = parsedName;
    }

    if (sku !== undefined) {
      const parsedSku = optionalText(sku);

      if (parsedSku && parsedSku.length > 100) {
        return res.status(400).json({
          success: false,
          message: "SKU must not exceed 100 characters",
        });
      }

      productData.sku = parsedSku ? parsedSku : null;
    }

    if (barcode !== undefined) {
      const parsedBarcode = optionalText(barcode);

      if (parsedBarcode && parsedBarcode.length > 100) {
        return res.status(400).json({
          success: false,
          message: "Barcode must not exceed 100 characters",
        });
      }

      productData.barcode = parsedBarcode ? parsedBarcode : null;
    }

    if (description !== undefined) {
      productData.description = optionalText(description) ?? "";
    }

    if (costPrice !== undefined) {
      const parsedCostPrice = Number(costPrice);

      if (!Number.isFinite(parsedCostPrice) || parsedCostPrice < 0) {
        return res.status(400).json({
          success: false,
          message: "Cost price must be a valid non-negative number",
        });
      }

      productData.costPrice = parsedCostPrice;
    }

    if (sellingPrice !== undefined) {
      const parsedSellingPrice = Number(sellingPrice);

      if (!Number.isFinite(parsedSellingPrice) || parsedSellingPrice < 0) {
        return res.status(400).json({
          success: false,
          message: "Selling price must be a valid non-negative number",
        });
      }

      productData.sellingPrice = parsedSellingPrice;
    }

    if (minimumStock !== undefined) {
      const parsedMinimumStock = Number(minimumStock);

      if (!Number.isFinite(parsedMinimumStock) || parsedMinimumStock < 0) {
        return res.status(400).json({
          success: false,
          message: "Minimum stock must be a valid non-negative number",
        });
      }

      productData.minimumStock = parsedMinimumStock;
    }

    if (unitOfMeasure !== undefined) {
      const parsedUnitOfMeasure = String(unitOfMeasure).trim();

      if (!parsedUnitOfMeasure || parsedUnitOfMeasure.length > 50) {
        return res.status(400).json({
          success: false,
          message: "Unit of measure is required and must not exceed 50 characters",
        });
      }

      productData.unitOfMeasure = parsedUnitOfMeasure;
    }

    if (Object.keys(productData).length === 0) {
      return res.status(400).json({
        success: false,
        message: "At least one field is required to update",
      });
    }

    const product = await updateBusinessProduct(
      req.businessId.toString(),
      id,
      productData
    );

    return res.status(200).json({
      success: true,
      message: "Product updated successfully",
      data: product,
    });
  } catch (error) {
    return sendProductError(res, error, "update");
  }
}

export async function deleteProductController(
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

    if (!id || Array.isArray(id) || !/^\d+$/.test(id) || id === "0") {
      return res.status(400).json({
        success: false,
        message: "A valid product ID is required",
      });
    }

    const product = await deleteBusinessProduct(
      req.businessId.toString(),
      id
    );

    return res.status(200).json({
      success: true,
      message: "Product deleted successfully",
      data: product,
    });
  } catch (error) {
    console.error("Delete product error:", error);

    if (error instanceof Error && error.message === "Product not found") {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to delete product",
    });
  }
}
