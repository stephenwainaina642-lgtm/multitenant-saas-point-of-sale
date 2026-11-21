import prisma from "../lib/prisma.js";
import { requirePublicId } from "../lib/public-id.js";
import { addBranchStock, takeBranchStock } from "../branches/branch-stock.js";

type InventoryMovementData = {
  productId: string;
  type: string;
  quantity: number;
  reference?: string;
  notes?: string;
};

export async function getBusinessInventoryMovements(
  businessId: string,
  branchId?: bigint
) {
  const movements = await prisma.inventoryMovement.findMany({
    where: {
      businessId: BigInt(businessId),
      ...(branchId && { branchId }),
    },
    include: {
      product: {
        select: {
          id: true,
          publicId: true,
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
    productId: movement.product.publicId,
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
  branchId: bigint,
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
        publicId: requirePublicId(data.productId, "A valid product ID is required"),
        businessId: BigInt(businessId),
        isActive: true,
      },
    });

    if (!product) {
      throw new Error("Product not found");
    }

    // Stock is counted per branch: this is what the active branch holds.
    const held = await tx.branchStock.findUnique({
      where: { branchId_productId: { branchId, productId: product.id } },
    });
    const currentStock = Number(held?.quantity ?? 0);
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
        branchId,
        productId: product.id,
        type,
        quantity: movementQuantity,
        reference: data.reference || null,
        notes: data.notes || null,
      },
    });

    const change = (newStock - currentStock).toFixed(3);
    if (Number(change) > 0) {
      await addBranchStock(tx, BigInt(businessId), branchId, product.id, change);
    } else if (Number(change) < 0) {
      const ok = await takeBranchStock(tx, BigInt(businessId), branchId, product.id, change.slice(1));
      if (!ok) throw new Error("Insufficient stock");
    }
    const updatedProduct = await tx.product.findUniqueOrThrow({ where: { id: product.id } });

    return {
      movement: {
        id: movement.id.toString(),
        productId: product.publicId,
        type: movement.type,
        quantity: movement.quantity,
        reference: movement.reference,
        notes: movement.notes,
        createdAt: movement.createdAt,
      },
      product: {
        id: updatedProduct.publicId,
        stockQuantity: updatedProduct.stockQuantity,
        branchQuantity: newStock,
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
