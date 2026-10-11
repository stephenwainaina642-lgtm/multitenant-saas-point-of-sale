import prisma from "../lib/prisma.js";

type QuotationItemData = {
  productId: string;
  quantity: number;
  unitPrice: number;
  discount?: number;
  tax?: number;
};

type QuotationData = {
  customerId?: string;
  quotationNumber: string;
  quotationDate?: string;
  expiryDate?: string;
  discount?: number;
  tax?: number;
  status?: string;
  notes?: string;
  items: QuotationItemData[];
};

export async function getBusinessQuotations(
  businessId: string
) {
  const quotations = await prisma.quotation.findMany({
    where: {
      businessId: BigInt(businessId),
    },
    include: {
      customer: {
        select: {
          id: true,
          name: true,
          phone: true,
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
      quotationDate: "desc",
    },
  });

  return quotations.map((quotation) => ({
    id: quotation.id.toString(),
    quotationNumber: quotation.quotationNumber,
    customerId: quotation.customer?.id.toString() || null,
    customerName: quotation.customer?.name || null,
    customerPhone: quotation.customer?.phone || null,
    quotationDate: quotation.quotationDate,
    expiryDate: quotation.expiryDate,
    subtotal: quotation.subtotal,
    discount: quotation.discount,
    tax: quotation.tax,
    total: quotation.total,
    status: quotation.status,
    notes: quotation.notes,
    items: quotation.items.map((item) => ({
      id: item.id.toString(),
      productId: item.productId.toString(),
      productName: item.product.name,
      sku: item.product.sku,
      unitOfMeasure: item.product.unitOfMeasure,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      discount: item.discount,
      tax: item.tax,
      total: item.total,
    })),
    createdAt: quotation.createdAt,
    updatedAt: quotation.updatedAt,
  }));
}

export async function getBusinessQuotationById(
  businessId: string,
  quotationId: string
) {
  const quotation = await prisma.quotation.findFirst({
    where: {
      id: BigInt(quotationId),
      businessId: BigInt(businessId),
    },
    include: {
      customer: {
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
          address: true,
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

  if (!quotation) {
    throw new Error("Quotation not found");
  }

  return {
    id: quotation.id.toString(),
    quotationNumber: quotation.quotationNumber,
    customerId: quotation.customer?.id.toString() || null,
    customer: quotation.customer
      ? {
          id: quotation.customer.id.toString(),
          name: quotation.customer.name,
          phone: quotation.customer.phone,
          email: quotation.customer.email,
          address: quotation.customer.address,
        }
      : null,
    quotationDate: quotation.quotationDate,
    expiryDate: quotation.expiryDate,
    subtotal: quotation.subtotal,
    discount: quotation.discount,
    tax: quotation.tax,
    total: quotation.total,
    status: quotation.status,
    notes: quotation.notes,
    items: quotation.items.map((item) => ({
      id: item.id.toString(),
      productId: item.productId.toString(),
      productName: item.product.name,
      sku: item.product.sku,
      unitOfMeasure: item.product.unitOfMeasure,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      discount: item.discount,
      tax: item.tax,
      total: item.total,
    })),
    createdAt: quotation.createdAt,
    updatedAt: quotation.updatedAt,
  };
}

export async function createBusinessQuotation(
  businessId: string,
  data: QuotationData
) {
  if (!data.quotationNumber?.trim()) {
    throw new Error("Quotation number is required");
  }

  if (!Array.isArray(data.items) || data.items.length === 0) {
    throw new Error("At least one quotation item is required");
  }

  const quotationDate = data.quotationDate
    ? new Date(data.quotationDate)
    : new Date();

  if (Number.isNaN(quotationDate.getTime())) {
    throw new Error("Invalid quotation date");
  }

  let expiryDate: Date | undefined;

  if (data.expiryDate) {
    expiryDate = new Date(data.expiryDate);

    if (Number.isNaN(expiryDate.getTime())) {
      throw new Error("Invalid expiry date");
    }
  }

  const quotationDiscount = Number(data.discount || 0);
  const quotationTax = Number(data.tax || 0);

  if (
    !Number.isFinite(quotationDiscount) ||
    quotationDiscount < 0
  ) {
    throw new Error("Invalid quotation discount");
  }

  if (!Number.isFinite(quotationTax) || quotationTax < 0) {
    throw new Error("Invalid quotation tax");
  }

  return prisma.$transaction(async (tx) => {
    const existingQuotation = await tx.quotation.findFirst({
      where: {
        businessId: BigInt(businessId),
        quotationNumber: data.quotationNumber.trim(),
      },
    });

    if (existingQuotation) {
      throw new Error("Quotation number already exists");
    }

    if (data.customerId) {
      const customer = await tx.customer.findFirst({
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

    const productIds = data.items.map((item) =>
      BigInt(item.productId)
    );

    const products = await tx.product.findMany({
      where: {
        id: {
          in: productIds,
        },
        businessId: BigInt(businessId),
        isActive: true,
      },
    });

    if (products.length !== data.items.length) {
      throw new Error("One or more products not found");
    }

    const productMap = new Map(
      products.map((product) => [
        product.id.toString(),
        product,
      ])
    );

    let subtotal = 0;

    const items = data.items.map((item) => {
      const quantity = Number(item.quantity);
      const unitPrice = Number(item.unitPrice);
      const discount = Number(item.discount || 0);
      const tax = Number(item.tax || 0);

      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error("Item quantity must be greater than zero");
      }

      if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        throw new Error("Item unit price cannot be negative");
      }

      if (!Number.isFinite(discount) || discount < 0) {
        throw new Error("Invalid item discount");
      }

      if (!Number.isFinite(tax) || tax < 0) {
        throw new Error("Invalid item tax");
      }

      const product = productMap.get(item.productId);

      if (!product) {
        throw new Error("Product not found");
      }

      const lineSubtotal = quantity * unitPrice;
      const lineTotal =
        lineSubtotal - discount + tax;

      if (lineTotal < 0) {
        throw new Error(
          `Invalid total for product: ${product.name}`
        );
      }

      subtotal += lineSubtotal;

      return {
        productId: product.id,
        quantity,
        unitPrice,
        discount,
        tax,
        total: lineTotal,
      };
    });

    const total =
      subtotal - quotationDiscount + quotationTax;

    if (total < 0) {
      throw new Error("Quotation total cannot be negative");
    }

    const quotation = await tx.quotation.create({
      data: {
        businessId: BigInt(businessId),
        customerId: data.customerId
          ? BigInt(data.customerId)
          : null,
        quotationNumber: data.quotationNumber.trim(),
        quotationDate,
        ...(expiryDate && {
          expiryDate,
        }),
        subtotal,
        discount: quotationDiscount,
        tax: quotationTax,
        total,
        status: data.status?.trim().toLowerCase() || "draft",
        notes: data.notes?.trim() || null,
        items: {
          create: items,
        },
      },
      include: {
        items: true,
      },
    });

    return {
      id: quotation.id.toString(),
      quotationNumber: quotation.quotationNumber,
      customerId: quotation.customerId?.toString() || null,
      subtotal: quotation.subtotal,
      discount: quotation.discount,
      tax: quotation.tax,
      total: quotation.total,
      status: quotation.status,
      notes: quotation.notes,
      items: quotation.items.map((item) => ({
        id: item.id.toString(),
        productId: item.productId.toString(),
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discount: item.discount,
        tax: item.tax,
        total: item.total,
      })),
      quotationDate: quotation.quotationDate,
      expiryDate: quotation.expiryDate,
      createdAt: quotation.createdAt,
      updatedAt: quotation.updatedAt,
    };
  });
}
