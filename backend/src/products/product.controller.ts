import type { Response } from "express";
import type { BusinessRequest } from "../auth/business.middleware.js";
import {
  getBusinessProducts,
  createBusinessProduct,
  updateBusinessProduct,
  deleteBusinessProduct,
} from "./product.service.js";

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

    const products = await getBusinessProducts(
      req.businessId.toString()
    );

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
    } = req.body;

    if (!name) {
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
      !Number.isFinite(parsedSellingPrice)
    ) {
      return res.status(400).json({
        success: false,
        message: "Cost price and selling price must be valid numbers",
      });
    }

    let parsedStockQuantity = 0;

    if (stockQuantity !== undefined) {
      parsedStockQuantity = Number(stockQuantity);

      if (!Number.isFinite(parsedStockQuantity)) {
        return res.status(400).json({
          success: false,
          message: "Stock quantity must be a valid number",
        });
      }
    }

    const product = await createBusinessProduct(
      req.businessId.toString(),
      {
        name: String(name),
        costPrice: parsedCostPrice,
        sellingPrice: parsedSellingPrice,
        stockQuantity: parsedStockQuantity,

        ...(sku !== undefined && {
          sku: String(sku),
        }),

        ...(barcode !== undefined && {
          barcode: String(barcode),
        }),

        ...(description !== undefined && {
          description: String(description),
        }),
      }
    );

    return res.status(201).json({
      success: true,
      message: "Product created successfully",
      data: product,
    });
  } catch (error) {
    console.error("Create product error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to create product",
    });
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

    if (!id || Array.isArray(id)) {
      return res.status(400).json({
        success: false,
        message: "Product ID is required",
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
    } = req.body;

    const productData: {
      name?: string;
      sku?: string;
      barcode?: string;
      description?: string;
      costPrice?: number;
      sellingPrice?: number;
      stockQuantity?: number;
    } = {};

    if (name !== undefined) {
      productData.name = String(name);
    }

    if (sku !== undefined) {
      productData.sku = String(sku);
    }

    if (barcode !== undefined) {
      productData.barcode = String(barcode);
    }

    if (description !== undefined) {
      productData.description = String(description);
    }

    if (costPrice !== undefined) {
      const parsedCostPrice = Number(costPrice);

      if (!Number.isFinite(parsedCostPrice)) {
        return res.status(400).json({
          success: false,
          message: "Cost price must be a valid number",
        });
      }

      productData.costPrice = parsedCostPrice;
    }

    if (sellingPrice !== undefined) {
      const parsedSellingPrice = Number(sellingPrice);

      if (!Number.isFinite(parsedSellingPrice)) {
        return res.status(400).json({
          success: false,
          message: "Selling price must be a valid number",
        });
      }

      productData.sellingPrice = parsedSellingPrice;
    }

    if (stockQuantity !== undefined) {
      const parsedStockQuantity = Number(stockQuantity);

      if (!Number.isFinite(parsedStockQuantity)) {
        return res.status(400).json({
          success: false,
          message: "Stock quantity must be a valid number",
        });
      }

      productData.stockQuantity = parsedStockQuantity;
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
    console.error("Update product error:", error);

    if (
      error instanceof Error &&
      error.message === "Product not found"
    ) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to update product",
    });
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

    if (!id || Array.isArray(id)) {
      return res.status(400).json({
        success: false,
        message: "Product ID is required",
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

    if (
      error instanceof Error &&
      error.message === "Product not found"
    ) {
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