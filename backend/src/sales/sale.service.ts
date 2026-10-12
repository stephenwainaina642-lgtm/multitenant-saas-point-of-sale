import prisma from "../lib/prisma.js";

type SaleItemData = {
  productId: string;
  quantity: number;
  unitPrice: number;
  discount?: number;
  tax?: number;
};

type SaleData = {
  customerId?: string;
  discount?: number;
  tax?: number;
  amountPaid?: number;
  paymentMethod?: string;
  notes?: string;
  items: SaleItemData[];
};

export async function getBusinessSales(
  businessId: string
) {
  const sales = await prisma.sale.findMany({
    where: {
      businessId: BigInt(businessId),
    },
    include: {
      customer: {
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

  return sales.map((sale) => ({
    id: sale.id.toString(),
    customerId: sale.customerId?.toString() || null,
    customerName: sale.customer?.name || null,
    receiptNumber: sale.receiptNumber,
    saleDate: sale.saleDate,
    subtotal: sale.subtotal,
    discount: sale.discount,
    tax: sale.tax,
    total: sale.total,
    amountPaid: sale.amountPaid,
    balanceDue: sale.balanceDue,
    paymentStatus: sale.paymentStatus,
    status: sale.status,
    notes: sale.notes,
    createdAt: sale.createdAt,
    items: sale.items.map((item) => ({
      id: item.id.toString(),
      productId: item.productId.toString(),
      productName: item.product.name,
      sku: item.product.sku,
      unitOfMeasure: item.product.unitOfMeasure,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      costPrice: item.costPrice,
      discount: item.discount,
      tax: item.tax,
      total: item.total,
    })),
  }));
}

export async function getBusinessSaleById(
  businessId: string,
  saleId: string
) {
  const sale = await prisma.sale.findFirst({
    where: {
      id: BigInt(saleId),
      businessId: BigInt(businessId),
    },
    include: {
      customer: {
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
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
  });

  if (!sale) {
    throw new Error("Sale not found");
  }

  return {
    id: sale.id.toString(),
    customerId: sale.customerId?.toString() || null,
    customerName: sale.customer?.name || null,
    customerPhone: sale.customer?.phone || null,
    customerEmail: sale.customer?.email || null,
    receiptNumber: sale.receiptNumber,
    saleDate: sale.saleDate,
    subtotal: sale.subtotal,
    discount: sale.discount,
    tax: sale.tax,
    total: sale.total,
    amountPaid: sale.amountPaid,
    balanceDue: sale.balanceDue,
    paymentStatus: sale.paymentStatus,
    status: sale.status,
    notes: sale.notes,
    createdAt: sale.createdAt,
    updatedAt: sale.updatedAt,
    items: sale.items.map((item) => ({
      id: item.id.toString(),
      productId: item.productId.toString(),
      productName: item.product.name,
      sku: item.product.sku,
      unitOfMeasure: item.product.unitOfMeasure,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      costPrice: item.costPrice,
      discount: item.discount,
      tax: item.tax,
      total: item.total,
    })),
  };
}

export async function createBusinessSale(
  businessId: string,
  data: SaleData
) {
  if (!data.items || data.items.length === 0) {
    throw new Error("At least one sale item is required");
  }

  return prisma.$transaction(async (tx) => {
    let customer = null;

    if (data.customerId) {
      customer = await tx.customer.findFirst({
        where: {
          id: BigInt(data.customerId),
          businessId: BigInt(businessId),
          isActive: true,
        },
      });

      if (!customer) {
        throw new Error("Customer not found");
      }
    }

    let subtotal = 0;

    const validatedItems: {
      productId: bigint;
      quantity: number;
      unitPrice: number;
      costPrice: number;
      discount: number;
      tax: number;
      total: number;
    }[] = [];

    for (const item of data.items) {
      const quantity = Number(item.quantity);
      const unitPrice = Number(item.unitPrice);
      const discount = Number(item.discount || 0);
      const tax = Number(item.tax || 0);

      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error("Quantity must be greater than zero");
      }

      if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        throw new Error("Unit price cannot be negative");
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

      const currentStock = Number(product.stockQuantity);

      if (quantity > currentStock) {
        throw new Error(
          `Insufficient stock for product: ${product.name}`
        );
      }

      const lineSubtotal = quantity * unitPrice;
      const lineTotal = lineSubtotal - discount + tax;

      if (lineTotal < 0) {
        throw new Error("Item total cannot be negative");
      }

      subtotal += lineSubtotal;

      validatedItems.push({
        productId: product.id,
        quantity,
        unitPrice,
        costPrice: Number(product.costPrice),
        discount,
        tax,
        total: lineTotal,
      });
    }

    const saleDiscount = Number(data.discount || 0);
    const saleTax = Number(data.tax || 0);
    const amountPaid = Number(data.amountPaid || 0);

    if (!Number.isFinite(saleDiscount) || saleDiscount < 0) {
      throw new Error("Sale discount cannot be negative");
    }

    if (!Number.isFinite(saleTax) || saleTax < 0) {
      throw new Error("Sale tax cannot be negative");
    }

    if (!Number.isFinite(amountPaid) || amountPaid < 0) {
      throw new Error("Amount paid cannot be negative");
    }

    const total = subtotal - saleDiscount + saleTax;

    if (total < 0) {
      throw new Error("Sale total cannot be negative");
    }

    if (amountPaid > total) {
      throw new Error("Amount paid cannot exceed sale total");
    }

    if (amountPaid > 0 && !data.paymentMethod?.trim()) {
      throw new Error("Payment method is required when an initial payment is made");
    }

    const balanceDue = total - amountPaid;

    const receiptNumber = `SALE-${Date.now()}`;

    const paymentStatus =
      balanceDue === 0
        ? "paid"
        : amountPaid > 0
          ? "partial"
          : "unpaid";

    const sale = await tx.sale.create({
      data: {
        businessId: BigInt(businessId),
        customerId: customer?.id || null,
        receiptNumber,
        subtotal,
        discount: saleDiscount,
        tax: saleTax,
        total,
        amountPaid,
        balanceDue,
        paymentStatus,
        status: "completed",
        notes: data.notes || null,
        items: {
          create: validatedItems.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            costPrice: item.costPrice,
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

    if (amountPaid > 0) {
      await tx.payment.create({
        data: {
          businessId: BigInt(businessId),
          saleId: sale.id,
          amount: amountPaid,
          method: data.paymentMethod!.trim().toLowerCase(),
          notes: "Initial payment for sale",
        },
      });
    }

    for (const item of validatedItems) {
      const product = await tx.product.findUnique({
        where: {
          id: item.productId,
        },
      });

      if (!product) {
        throw new Error("Product not found");
      }

      const stockUpdate = await tx.product.updateMany({
        where: {
          id: item.productId,
          businessId: BigInt(businessId),
          isActive: true,
          stockQuantity: {
            gte: item.quantity,
          },
        },
        data: {
          stockQuantity: {
            decrement: item.quantity,
          },
        },
      });

      if (stockUpdate.count === 0) {
        throw new Error(
          `Insufficient stock for product: ${product.name}`
        );
      }

      await tx.inventoryMovement.create({
        data: {
          businessId: BigInt(businessId),
          productId: item.productId,
          type: "OUT",
          quantity: item.quantity,
          reference: `SALE-${sale.id.toString()}`,
          notes: `Stock sold${customer ? ` to ${customer.name}` : ""}`,
        },
      });
    }

    return {
      id: sale.id.toString(),
      customerId: sale.customerId?.toString() || null,
      customerName: customer?.name || null,
      receiptNumber: sale.receiptNumber,
      saleDate: sale.saleDate,
      subtotal: sale.subtotal,
      discount: sale.discount,
      tax: sale.tax,
      total: sale.total,
      amountPaid: sale.amountPaid,
      balanceDue: sale.balanceDue,
      paymentStatus: sale.paymentStatus,
      status: sale.status,
      notes: sale.notes,
      createdAt: sale.createdAt,
      items: sale.items.map((item) => ({
        id: item.id.toString(),
        productId: item.productId.toString(),
        quantity: item.quantity,
        costPrice: item.costPrice,
        discount: item.discount,
        tax: item.tax,
        total: item.total,
      })),
    };
  });
}
