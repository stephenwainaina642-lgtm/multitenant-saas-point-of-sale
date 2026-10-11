import prisma from "../lib/prisma.js";

type CreateInvoiceData = {
  saleId: string;
  invoiceNumber: string;
  invoiceDate?: string;
  dueDate?: string;
  status?: string;
  notes?: string;
};

export async function getBusinessInvoices(
  businessId: string
) {
  const invoices = await prisma.invoice.findMany({
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
      sale: {
        select: {
          id: true,
          receiptNumber: true,
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
      invoiceDate: "desc",
    },
  });

  return invoices.map((invoice) => ({
    id: invoice.id.toString(),
    invoiceNumber: invoice.invoiceNumber,
    saleId: invoice.saleId.toString(),
    receiptNumber: invoice.sale.receiptNumber,
    customerId: invoice.customer?.id.toString() || null,
    customerName: invoice.customer?.name || null,
    customerPhone: invoice.customer?.phone || null,
    invoiceDate: invoice.invoiceDate,
    dueDate: invoice.dueDate,
    subtotal: invoice.subtotal,
    discount: invoice.discount,
    tax: invoice.tax,
    total: invoice.total,
    amountPaid: invoice.amountPaid,
    balanceDue: invoice.balanceDue,
    status: invoice.status,
    notes: invoice.notes,
    items: invoice.items.map((item) => ({
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
    createdAt: invoice.createdAt,
    updatedAt: invoice.updatedAt,
  }));
}

export async function getBusinessInvoiceById(
  businessId: string,
  invoiceId: string
) {
  const invoice = await prisma.invoice.findFirst({
    where: {
      id: BigInt(invoiceId),
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
      sale: {
        select: {
          id: true,
          receiptNumber: true,
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

  if (!invoice) {
    throw new Error("Invoice not found");
  }

  return {
    id: invoice.id.toString(),
    invoiceNumber: invoice.invoiceNumber,
    saleId: invoice.saleId.toString(),
    receiptNumber: invoice.sale.receiptNumber,
    customerId: invoice.customer?.id.toString() || null,
    customer: invoice.customer
      ? {
          id: invoice.customer.id.toString(),
          name: invoice.customer.name,
          phone: invoice.customer.phone,
          email: invoice.customer.email,
          address: invoice.customer.address,
        }
      : null,
    invoiceDate: invoice.invoiceDate,
    dueDate: invoice.dueDate,
    subtotal: invoice.subtotal,
    discount: invoice.discount,
    tax: invoice.tax,
    total: invoice.total,
    amountPaid: invoice.amountPaid,
    balanceDue: invoice.balanceDue,
    status: invoice.status,
    notes: invoice.notes,
    items: invoice.items.map((item) => ({
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
    createdAt: invoice.createdAt,
    updatedAt: invoice.updatedAt,
  };
}

export async function createBusinessInvoice(
  businessId: string,
  data: CreateInvoiceData
) {
  if (!data.saleId?.trim()) {
    throw new Error("Sale ID is required");
  }

  if (!data.invoiceNumber?.trim()) {
    throw new Error("Invoice number is required");
  }

  const invoiceDate = data.invoiceDate
    ? new Date(data.invoiceDate)
    : new Date();

  if (Number.isNaN(invoiceDate.getTime())) {
    throw new Error("Invalid invoice date");
  }

  let dueDate: Date | undefined;

  if (data.dueDate) {
    dueDate = new Date(data.dueDate);

    if (Number.isNaN(dueDate.getTime())) {
      throw new Error("Invalid due date");
    }
  }

  return prisma.$transaction(async (tx) => {
    const existingInvoice = await tx.invoice.findFirst({
      where: {
        businessId: BigInt(businessId),
        invoiceNumber: data.invoiceNumber.trim(),
      },
    });

    if (existingInvoice) {
      throw new Error("Invoice number already exists");
    }

    const sale = await tx.sale.findFirst({
      where: {
        id: BigInt(data.saleId),
        businessId: BigInt(businessId),
      },
      include: {
        customer: true,
        items: true,
        invoice: true,
      },
    });

    if (!sale) {
      throw new Error("Sale not found");
    }

    if (sale.invoice) {
      throw new Error("Sale already has an invoice");
    }

    if (sale.items.length === 0) {
      throw new Error("Sale has no items");
    }

    const invoice = await tx.invoice.create({
      data: {
        businessId: BigInt(businessId),
        customerId: sale.customerId,
        saleId: sale.id,
        invoiceNumber: data.invoiceNumber.trim(),
        invoiceDate,
        ...(dueDate && {
          dueDate,
        }),
        subtotal: sale.subtotal,
        discount: sale.discount,
        tax: sale.tax,
        total: sale.total,
        amountPaid: sale.amountPaid,
        balanceDue: sale.balanceDue,
        status:
          data.status?.trim().toLowerCase() ||
          (Number(sale.balanceDue) === 0 ? "paid" : "unpaid"),
        notes: data.notes?.trim() || sale.notes || null,
        items: {
          create: sale.items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
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

    return {
      id: invoice.id.toString(),
      invoiceNumber: invoice.invoiceNumber,
      saleId: invoice.saleId.toString(),
      customerId: invoice.customerId?.toString() || null,
      invoiceDate: invoice.invoiceDate,
      dueDate: invoice.dueDate,
      subtotal: invoice.subtotal,
      discount: invoice.discount,
      tax: invoice.tax,
      total: invoice.total,
      amountPaid: invoice.amountPaid,
      balanceDue: invoice.balanceDue,
      status: invoice.status,
      notes: invoice.notes,
      items: invoice.items.map((item) => ({
        id: item.id.toString(),
        productId: item.productId.toString(),
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discount: item.discount,
        tax: item.tax,
        total: item.total,
      })),
      createdAt: invoice.createdAt,
      updatedAt: invoice.updatedAt,
    };
  });
}
