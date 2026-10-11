import prisma from "../lib/prisma.js";

type InventoryMovementData = {
  productId: string;
  type: string;
  quantity: number;
  reference?: string;
  notes?: string;
};

export async function getBusinessInventoryMovements(
  businessId: string
) {
  const movements = await prisma.inventoryMovement.findMany({
    where: {
      businessId: BigInt(businessId),
    },
    include: {
      product: {
        select: {
          id: true,
          name: true,
          sku: true,
          unitOfMeasure: true,
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return movements.map((movement) => ({
    id: movement.id.toString(),
    productId: movement.productId.toString(),
    productName: movement.product.name,
    sku: movement.product.sku,
    unitOfMeasure: movement.product.unitOfMeasure,
    type: movement.type,
    quantity: movement.quantity,
    reference: movement.reference,
    notes: movement.notes,
    createdAt: movement.createdAt,
  }));
}

export async function createInventoryMovement(
  businessId: string,
  data: InventoryMovementData
) {
  const result = await prisma.$transaction(async (tx) => {
    const product = await tx.product.findFirst({
      where: {
        id: BigInt(data.productId),
        businessId: BigInt(businessId),
        isActive: true,
      },
    });

    if (!product) {
      throw new Error("Product not found");
    }

    const quantity = data.quantity;

    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error("Quantity must be greater than zero");
    }

    const type = data.type.toUpperCase();

    let stockChange = 0;

    if (type === "IN") {
      stockChange = quantity;
    } else if (type === "OUT") {
      stockChange = -quantity;
    } else if (type === "ADJUSTMENT") {
      stockChange = quantity;
    } else {
      throw new Error(
        "Invalid movement type. Use IN, OUT, or ADJUSTMENT"
      );
    }

    const currentStock = Number(product.stockQuantity);
    const newStock = currentStock + stockChange;

    if (newStock < 0) {
      throw new Error("Insufficient stock");
    }

    const movement = await tx.inventoryMovement.create({
      data: {
        businessId: BigInt(businessId),
        productId: BigInt(data.productId),
        type,
        quantity,
        reference: data.reference || null,
        notes: data.notes || null,
      },
    });

    const updatedProduct = await tx.product.update({
      where: {
        id: product.id,
      },
      data: {
        stockQuantity: newStock,
      },
    });

    return {
      movement: {
        id: movement.id.toString(),
        productId: movement.productId.toString(),
        type: movement.type,
        quantity: movement.quantity,
        reference: movement.reference,
        notes: movement.notes,
        createdAt: movement.createdAt,
      },
      product: {
        id: updatedProduct.id.toString(),
        name: updatedProduct.name,
        stockQuantity: updatedProduct.stockQuantity,
      },
    };
  });

  return result;
}
