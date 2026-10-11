import prisma from "../lib/prisma.js";

type PurchaseItemData = {
  productId: string;
  quantity: number;
  unitCost: number;
  discount?: number;
  tax?: number;
};

type PurchaseData = {
  supplierId: string;
  invoiceNumber?: string;
  discount?: number;
  tax?: number;
  amountPaid?: number;
  notes?: string;
  items: PurchaseItemData[];
};

export async function getBusinessPurchases(
  businessId: string
) {
  const purchases = await prisma.purchase.findMany({
    where: {
      businessId: BigInt(businessId),
    },
    include: {
      supplier: {
        select: {
          id: true,
          name: true,
        },
      },
      items: {
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
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return purchases.map((purchase) => ({
    id: purchase.id.toString(),
    supplierId: purchase.supplierId.toString(),
    supplierName: purchase.supplier.name,
    invoiceNumber: purchase.invoiceNumber,
    purchaseDate: purchase.purchaseDate,
    subtotal: purchase.subtotal,
    discount: purchase.discount,
    tax: purchase.tax,
    total: purchase.total,
    amountPaid: purchase.amountPaid,
    balanceDue: purchase.balanceDue,
    status: purchase.status,
    notes: purchase.notes,
    createdAt: purchase.createdAt,
    items: purchase.items.map((item) => ({
      id: item.id.toString(),
      productId: item.productId.toString(),
      productName: item.product.name,
      sku: item.product.sku,
      unitOfMeasure: item.product.unitOfMeasure,
      quantity: item.quantity,
      unitCost: item.unitCost,
      discount: item.discount,
      tax: item.tax,
      total: item.total,
    })),
  }));
}

export async function createBusinessPurchase(
  businessId: string,
  data: PurchaseData
) {
  if (!data.items || data.items.length === 0) {
    throw new Error("At least one purchase item is required");
  }

  return prisma.$transaction(async (tx) => {
    const supplier = await tx.supplier.findFirst({
      where: {
        id: BigInt(data.supplierId),
        businessId: BigInt(businessId),
        isActive: true,
      },
    });

    if (!supplier) {
      throw new Error("Supplier not found");
    }

    let subtotal = 0;

    const validatedItems: {
      productId: bigint;
      quantity: number;
      unitCost: number;
      discount: number;
      tax: number;
      total: number;
    }[] = [];

    for (const item of data.items) {
      const quantity = Number(item.quantity);
      const unitCost = Number(item.unitCost);
      const discount = Number(item.discount || 0);
      const tax = Number(item.tax || 0);

      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error("Quantity must be greater than zero");
      }

      if (!Number.isFinite(unitCost) || unitCost < 0) {
        throw new Error("Unit cost cannot be negative");
      }

      if (!Number.isFinite(discount) || discount < 0) {
        throw new Error("Discount cannot be negative");
      }

      if (!Number.isFinite(tax) || tax < 0) {
        throw new Error("Tax cannot be negative");
      }

      const product = await tx.product.findFirst({
        where: {
          id: BigInt(item.productId),
          businessId: BigInt(businessId),
          isActive: true,
        },
      });

      if (!product) {
        throw new Error(`Product not found: ${item.productId}`);
      }

      const lineSubtotal = quantity * unitCost;
      const lineTotal = lineSubtotal - discount + tax;

      if (lineTotal < 0) {
        throw new Error("Item total cannot be negative");
      }

      subtotal += lineSubtotal;

      validatedItems.push({
        productId: product.id,
        quantity,
        unitCost,
        discount,
        tax,
        total: lineTotal,
      });
    }

    const purchaseDiscount = Number(data.discount || 0);
    const purchaseTax = Number(data.tax || 0);
    const amountPaid = Number(data.amountPaid || 0);

    if (!Number.isFinite(purchaseDiscount) || purchaseDiscount < 0) {
      throw new Error("Purchase discount cannot be negative");
    }

    if (!Number.isFinite(purchaseTax) || purchaseTax < 0) {
      throw new Error("Purchase tax cannot be negative");
    }

    if (!Number.isFinite(amountPaid) || amountPaid < 0) {
      throw new Error("Amount paid cannot be negative");
    }

    const total = subtotal - purchaseDiscount + purchaseTax;

    if (total < 0) {
      throw new Error("Purchase total cannot be negative");
    }

    if (amountPaid > total) {
      throw new Error("Amount paid cannot exceed purchase total");
    }

    const balanceDue = total - amountPaid;

    const purchase = await tx.purchase.create({
      data: {
        businessId: BigInt(businessId),
        supplierId: supplier.id,
        invoiceNumber: data.invoiceNumber || null,
        subtotal,
        discount: purchaseDiscount,
        tax: purchaseTax,
        total,
        amountPaid,
        balanceDue,
        status: "received",
        notes: data.notes || null,
        items: {
          create: validatedItems.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            unitCost: item.unitCost,
            discount: item.discount,
            tax: item.tax,
            total: item.total,
          })),
        },
      },
      include: {
        items: true,
      },
    });

    for (const item of validatedItems) {
      const product = await tx.product.findUnique({
        where: {
          id: item.productId,
        },
      });

      if (!product) {
        throw new Error("Product not found");
      }

      const newStock =
        Number(product.stockQuantity) + item.quantity;

      await tx.product.update({
        where: {
          id: item.productId,
        },
        data: {
          stockQuantity: newStock,
          costPrice: item.unitCost,
        },
      });

      await tx.inventoryMovement.create({
        data: {
          businessId: BigInt(businessId),
          productId: item.productId,
          type: "IN",
          quantity: item.quantity,
          reference: `PURCHASE-${purchase.id.toString()}`,
          notes: `Stock received from ${supplier.name}`,
        },
      });
    }

    return {
      id: purchase.id.toString(),
      supplierId: purchase.supplierId.toString(),
      supplierName: supplier.name,
      invoiceNumber: purchase.invoiceNumber,
      purchaseDate: purchase.purchaseDate,
      subtotal: purchase.subtotal,
      discount: purchase.discount,
      tax: purchase.tax,
      total: purchase.total,
      amountPaid: purchase.amountPaid,
      balanceDue: purchase.balanceDue,
      status: purchase.status,
      notes: purchase.notes,
      createdAt: purchase.createdAt,
      items: purchase.items.map((item) => ({
        id: item.id.toString(),
        productId: item.productId.toString(),
        quantity: item.quantity,
        unitCost: item.unitCost,
        discount: item.discount,
        tax: item.tax,
        total: item.total,
      })),
    };
  });
}
