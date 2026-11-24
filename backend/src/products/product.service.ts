import { addBranchStock } from "../branches/branch-stock.js";
import prisma from "../lib/prisma.js";
import { AppError } from "../lib/errors.js";
import { requirePublicId } from "../lib/public-id.js";

export async function getBusinessProducts(businessId: string) {
  const products = await prisma.product.findMany({
    where: {
      businessId: BigInt(businessId),
      isActive: true,
    },
    include: { category: { select: { publicId: true, name: true } } },
    orderBy: {
      createdAt: "desc",
    },
  });

  return products.map((product) => ({
    id: product.publicId,
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
    categoryId: product.category?.publicId ?? null,
    categoryName: product.category?.name ?? null,
    isActive: product.isActive,
    tracksStock: product.tracksStock,
    isAvailable: product.isAvailable,
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
    tracksStock?: boolean;
    isAvailable?: boolean;
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
        ...(data.tracksStock !== undefined && { tracksStock: data.tracksStock }),
        ...(data.isAvailable !== undefined && { isAvailable: data.isAvailable }),
      },
    });

    if (openingStock > 0 && product.tracksStock) {
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

    const stocked = await tx.product.findUniqueOrThrow({ where: { id: product.id }, include: { category: { select: { publicId: true } } } });
    return {
      id: product.publicId,
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
      categoryId: stocked.category?.publicId ?? null,
      isActive: product.isActive,
      tracksStock: product.tracksStock,
      isAvailable: product.isAvailable,
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
    isAvailable?: boolean;
    tracksStock?: boolean;
  }
) {
  const product = await prisma.product.findFirst({
    where: {
      publicId: requirePublicId(productId, "A valid product ID is required"),
      businessId: BigInt(businessId),
      isActive: true,
    },
  });

  if (!product) {
    throw new Error("Product not found");
  }

  // Switching stock tracking after the item has been sold would leave stock figures that do not match history.
  if (data.tracksStock !== undefined && data.tracksStock !== product.tracksStock) {
    const sold = await prisma.saleItem.count({ where: { productId: product.id } });
    if (sold > 0) throw new AppError(409, "Stock tracking can't be changed once the item has been sold. Add a new item instead.");
    if (!data.tracksStock && Number(product.stockQuantity) > 0) throw new AppError(409, "Take the remaining stock out first (stock adjustment), then switch off stock tracking.");
  }

  const updatedProduct = await prisma.product.update({
    where: {
      id: product.id,
    },
    data,
    include: { category: { select: { publicId: true } } },
  });

  return {
    id: updatedProduct.publicId,
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
    categoryId: updatedProduct.category?.publicId ?? null,
    isActive: updatedProduct.isActive,
    tracksStock: updatedProduct.tracksStock,
    isAvailable: updatedProduct.isAvailable,
  };
}

export async function deleteBusinessProduct(
  businessId: string,
  productId: string
) {
  const product = await prisma.product.findFirst({
    where: {
      publicId: requirePublicId(productId, "A valid product ID is required"),
      businessId: BigInt(businessId),
      isActive: true,
    },
  });

  if (!product) {
    throw new Error("Product not found");
  }

  const deletedProduct = await prisma.product.update({
    where: {
      id: product.id,
    },
    data: {
      isActive: false,
    },
  });

  return {
    id: deletedProduct.publicId,
    name: deletedProduct.name,
    isActive: deletedProduct.isActive,
  };
}
