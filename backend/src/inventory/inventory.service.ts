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
  const type = data.type.toUpperCase();
  const requestedQuantity = data.quantity;

  if (!["IN", "OUT", "ADJUSTMENT"].includes(type)) {
    throw new Error("Invalid movement type. Use IN, OUT, or ADJUSTMENT");
  }

  if (
    !Number.isFinite(requestedQuantity) ||
    requestedQuantity < 0
  ) {
    throw new Error("Quantity must not be negative");
  }

  if (type !== "ADJUSTMENT" && requestedQuantity === 0) {
    throw new Error(
      "Quantity must be greater than zero for stock IN or OUT"
    );
  }

  let result;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      result = await prisma.$transaction(async (tx) => {
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

    const currentStock = Number(product.stockQuantity);
    let stockChange: number;

    if (type === "IN") {
      stockChange = requestedQuantity;
    } else if (type === "OUT") {
      stockChange = -requestedQuantity;
    } else {
      // For ADJUSTMENT, quantity is the actual counted stock.
      stockChange = requestedQuantity - currentStock;
    }

    const newStock =
      type === "ADJUSTMENT"
        ? requestedQuantity
        : currentStock + stockChange;

    if (newStock < 0) {
      throw new Error("Insufficient stock");
    }

    const movementQuantity =
      type === "ADJUSTMENT" ? stockChange : requestedQuantity;

    const movement = await tx.inventoryMovement.create({
      data: {
        businessId: BigInt(businessId),
        productId: product.id,
        type,
        quantity: movementQuantity,
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
        stockQuantity: updatedProduct.stockQuantity,
      },
    };
      }, { isolationLevel: "Serializable" });

      break;
    } catch (error) {
      const code =
        typeof error === "object" &&
        error !== null &&
        "code" in error
          ? (error as { code?: string }).code
          : undefined;

      if (code !== "P2034" || attempt === 3) {
        throw error;
      }
    }
  }

  if (result === undefined) {
    throw new Error("Inventory transaction did not complete");
  }

  return result;
}
