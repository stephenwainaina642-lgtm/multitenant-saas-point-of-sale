import { addBranchStock } from "../branches/branch-stock.js";
import prisma from "../lib/prisma.js";

export async function getBusinessProducts(businessId: string) {
  const products = await prisma.product.findMany({
    where: {
      businessId: BigInt(businessId),
      isActive: true,
    },
    include: { category: { select: { name: true } } },
    orderBy: {
      createdAt: "desc",
    },
  });

  return products.map((product) => ({
    id: product.id.toString(),
    name: product.name,
    sku: product.sku,
    barcode: product.barcode,
    description: product.description,
    sellingPrice: product.sellingPrice,
    costPrice: product.costPrice,
    stockQuantity: product.stockQuantity,
    minimumStock: product.minimumStock,
    unitOfMeasure: product.unitOfMeasure,
    taxClass: product.taxClass,
    categoryId: product.categoryId ? product.categoryId.toString() : null,
    categoryName: product.category?.name ?? null,
    isActive: product.isActive,
  }));
}

export async function createBusinessProduct(
  businessId: string,
  branchId: bigint,
  data: {
    name: string;
    sku?: string;
    barcode?: string;
    description?: string;
    costPrice: number;
    sellingPrice: number;
    stockQuantity?: number;
    minimumStock?: number;
    unitOfMeasure?: string;
    taxClass?: string;
    categoryId?: bigint | null;
  }
) {
  const openingStock = data.stockQuantity ?? 0;

  return prisma.$transaction(async (tx) => {
    const product = await tx.product.create({
      data: {
        businessId: BigInt(businessId),
        name: data.name.trim(),
        sku: data.sku?.trim() || null,
        barcode: data.barcode?.trim() || null,
        description: data.description?.trim() || null,
        costPrice: data.costPrice,
        sellingPrice: data.sellingPrice,
        stockQuantity: 0, // opening stock is added to the branch below
        minimumStock: data.minimumStock ?? 0,
        unitOfMeasure: data.unitOfMeasure || "piece",
        taxClass: data.taxClass || "standard",
        categoryId: data.categoryId ?? null,
        isActive: true,
      },
    });

    if (openingStock > 0) {
      await addBranchStock(tx, BigInt(businessId), branchId, product.id, String(openingStock));
      await tx.inventoryMovement.create({
        data: {
          businessId: BigInt(businessId),
          branchId,
          productId: product.id,
          type: "IN",
          quantity: openingStock,
          reference: "OPENING-STOCK",
          notes: "Initial stock recorded when product was created",
        },
      });
    }

    const stocked = await tx.product.findUniqueOrThrow({ where: { id: product.id } });
    return {
      id: product.id.toString(),
      name: product.name,
      sku: product.sku,
      barcode: product.barcode,
      description: product.description,
      costPrice: product.costPrice,
      sellingPrice: product.sellingPrice,
      stockQuantity: stocked.stockQuantity,
      minimumStock: product.minimumStock,
      unitOfMeasure: product.unitOfMeasure,
      taxClass: product.taxClass,
      categoryId: product.categoryId ? product.categoryId.toString() : null,
      isActive: product.isActive,
    };
  });
}

export async function updateBusinessProduct(
  businessId: string,
  productId: string,
  data: {
    name?: string;
    sku?: string | null;
    barcode?: string | null;
    description?: string;
    costPrice?: number;
    sellingPrice?: number;
    minimumStock?: number;
    unitOfMeasure?: string;
    taxClass?: string;
    categoryId?: bigint | null;
  }
) {
  const product = await prisma.product.findFirst({
    where: {
      id: BigInt(productId),
      businessId: BigInt(businessId),
      isActive: true,
    },
  });

  if (!product) {
    throw new Error("Product not found");
  }

  const updatedProduct = await prisma.product.update({
    where: {
      id: BigInt(productId),
    },
    data,
  });

  return {
    id: updatedProduct.id.toString(),
    name: updatedProduct.name,
    sku: updatedProduct.sku,
    barcode: updatedProduct.barcode,
    description: updatedProduct.description,
    costPrice: updatedProduct.costPrice,
    sellingPrice: updatedProduct.sellingPrice,
    stockQuantity: updatedProduct.stockQuantity,
    minimumStock: updatedProduct.minimumStock,
    unitOfMeasure: updatedProduct.unitOfMeasure,
    taxClass: updatedProduct.taxClass,
    categoryId: updatedProduct.categoryId ? updatedProduct.categoryId.toString() : null,
    isActive: updatedProduct.isActive,
  };
}

export async function deleteBusinessProduct(
  businessId: string,
  productId: string
) {
  const product = await prisma.product.findFirst({
    where: {
      id: BigInt(productId),
      businessId: BigInt(businessId),
      isActive: true,
    },
  });

  if (!product) {
    throw new Error("Product not found");
  }

  const deletedProduct = await prisma.product.update({
    where: {
      id: BigInt(productId),
    },
    data: {
      isActive: false,
    },
  });

  return {
    id: deletedProduct.id.toString(),
    name: deletedProduct.name,
    isActive: deletedProduct.isActive,
  };
}
