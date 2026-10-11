import prisma from "../lib/prisma.js";

type PaymentData = {
  saleId: string;
  amount: number;
  method: string;
  reference?: string;
  notes?: string;
};

export async function getBusinessPayments(
  businessId: string
) {
  const payments = await prisma.payment.findMany({
    where: {
      businessId: BigInt(businessId),
    },
    include: {
      sale: {
        select: {
          id: true,
          receiptNumber: true,
          customer: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return payments.map((payment) => ({
    id: payment.id.toString(),
    saleId: payment.saleId.toString(),
    receiptNumber: payment.sale.receiptNumber,
    customerId: payment.sale.customer?.id.toString() || null,
    customerName: payment.sale.customer?.name || null,
    amount: payment.amount,
    method: payment.method,
    reference: payment.reference,
    paymentDate: payment.paymentDate,
    notes: payment.notes,
    createdAt: payment.createdAt,
  }));
}

export async function createBusinessPayment(
  businessId: string,
  data: PaymentData
) {
  const amount = Number(data.amount);

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Payment amount must be greater than zero");
  }

  if (!data.method || !data.method.trim()) {
    throw new Error("Payment method is required");
  }

  return prisma.$transaction(async (tx) => {
    const sale = await tx.sale.findFirst({
      where: {
        id: BigInt(data.saleId),
        businessId: BigInt(businessId),
      },
    });

    if (!sale) {
      throw new Error("Sale not found");
    }

    const currentBalance = Number(sale.balanceDue);

    if (currentBalance <= 0) {
      throw new Error("Sale has no outstanding balance");
    }

    if (amount > currentBalance) {
      throw new Error("Payment amount cannot exceed outstanding balance");
    }

    const newAmountPaid =
      Number(sale.amountPaid) + amount;

    const newBalanceDue =
      Number(sale.total) - newAmountPaid;

    const paymentStatus =
      newBalanceDue === 0
        ? "paid"
        : "partial";

    const payment = await tx.payment.create({
      data: {
        businessId: BigInt(businessId),
        saleId: sale.id,
        amount,
        method: data.method.trim().toLowerCase(),
        reference: data.reference?.trim() || null,
        notes: data.notes?.trim() || null,
      },
    });

    const updatedSale = await tx.sale.update({
      where: {
        id: sale.id,
      },
      data: {
        amountPaid: newAmountPaid,
        balanceDue: newBalanceDue,
        paymentStatus,
      },
    });

    return {
      payment: {
        id: payment.id.toString(),
        saleId: payment.saleId.toString(),
        amount: payment.amount,
        method: payment.method,
        reference: payment.reference,
        paymentDate: payment.paymentDate,
        notes: payment.notes,
      },
      sale: {
        id: updatedSale.id.toString(),
        receiptNumber: updatedSale.receiptNumber,
        total: updatedSale.total,
        amountPaid: updatedSale.amountPaid,
        balanceDue: updatedSale.balanceDue,
        paymentStatus: updatedSale.paymentStatus,
      },
    };
  });
}
