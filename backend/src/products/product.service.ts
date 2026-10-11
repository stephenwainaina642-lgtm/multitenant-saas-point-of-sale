import prisma from "../lib/prisma.js";

export async function getBusinessProducts(businessId: string) {
  const products = await prisma.product.findMany({
    where: {
      businessId: BigInt(businessId),
      isActive: true,
    },
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
    isActive: product.isActive,
  }));
}

export async function createBusinessProduct(
  businessId: string,
  data: {
    name: string;
    sku?: string;
    barcode?: string;
    description?: string;
    costPrice: number;
    sellingPrice: number;
    stockQuantity?: number;
  }
) {
  const product = await prisma.product.create({
    data: {
      businessId: BigInt(businessId),
      name: data.name,
      sku: data.sku || null,
      barcode: data.barcode || null,
      description: data.description || null,
      costPrice: data.costPrice,
      sellingPrice: data.sellingPrice,
      stockQuantity: data.stockQuantity ?? 0,
      isActive: true,
    },
  });

  return {
    id: product.id.toString(),
    name: product.name,
    sku: product.sku,
    barcode: product.barcode,
    description: product.description,
    costPrice: product.costPrice,
    sellingPrice: product.sellingPrice,
    stockQuantity: product.stockQuantity,
    isActive: product.isActive,
  };
}

export async function updateBusinessProduct(
  businessId: string,
  productId: string,
  data: {
    name?: string;
    sku?: string;
    barcode?: string;
    description?: string;
    costPrice?: number;
    sellingPrice?: number;
    stockQuantity?: number;
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