import prisma from "../lib/prisma.js";

type ReportDateRange = {
  startDate: Date;
  endDateExclusive: Date;
};

function toNumber(value: unknown): number {
  return Number(value ?? 0);
}

function dateKey(date: Date, monthly: boolean): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");

  if (monthly) {
    return `${year}-${month}`;
  }

  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export async function getBusinessReports(
  businessId: string,
  range: ReportDateRange
) {
  const businessFilter = BigInt(businessId);

  const dateFilter = {
    gte: range.startDate,
    lt: range.endDateExclusive,
  };

  const [sales, payments, purchases, expenses] = await Promise.all([
    prisma.sale.findMany({
      where: {
        businessId: businessFilter,
        status: "completed",
        saleDate: dateFilter,
      },
      include: {
        items: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                sku: true,
              },
            },
          },
        },
      },
      orderBy: {
        saleDate: "asc",
      },
    }),

    prisma.payment.findMany({
      where: {
        businessId: businessFilter,
        paymentDate: dateFilter,
      },
      orderBy: {
        paymentDate: "asc",
      },
    }),

    prisma.purchase.findMany({
      where: {
        businessId: businessFilter,
        status: "received",
        purchaseDate: dateFilter,
      },
      include: {
        supplier: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: {
        purchaseDate: "asc",
      },
    }),

    prisma.expense.findMany({
      where: {
        businessId: businessFilter,
        expenseDate: dateFilter,
      },
      orderBy: {
        expenseDate: "asc",
      },
    }),
  ]);

  const totalSales = sales.reduce(
    (sum, sale) => sum + toNumber(sale.total),
    0
  );

  const salesTax = sales.reduce(
    (sum, sale) => sum + toNumber(sale.tax),
    0
  );

  const netSales = totalSales - salesTax;

  const costOfGoodsSold = sales.reduce(
    (sum, sale) =>
      sum +
      sale.items.reduce(
        (itemSum, item) =>
          itemSum +
          toNumber(item.costPrice) * toNumber(item.quantity),
        0
      ),
    0
  );

  const grossProfit = netSales - costOfGoodsSold;

  const totalPayments = payments.reduce(
    (sum, payment) => sum + toNumber(payment.amount),
    0
  );

  const totalExpenses = expenses.reduce(
    (sum, expense) => sum + toNumber(expense.amount),
    0
  );

  const netProfit = grossProfit - totalExpenses;

  const totalPurchases = purchases.reduce(
    (sum, purchase) => sum + toNumber(purchase.total),
    0
  );

  const purchasePayments = purchases.reduce(
    (sum, purchase) => sum + toNumber(purchase.amountPaid),
    0
  );

  const monthly =
    range.endDateExclusive.getTime() - range.startDate.getTime() >
    62 * 24 * 60 * 60 * 1000;

  const trendMap = new Map<
    string,
    { date: string; revenue: number; expenses: number }
  >();

  for (const sale of sales) {
    const key = dateKey(sale.saleDate, monthly);
    const current = trendMap.get(key) || {
      date: key,
      revenue: 0,
      expenses: 0,
    };

    current.revenue += toNumber(sale.total) - toNumber(sale.tax);
    trendMap.set(key, current);
  }

  for (const expense of expenses) {
    const key = dateKey(expense.expenseDate, monthly);
    const current = trendMap.get(key) || {
      date: key,
      revenue: 0,
      expenses: 0,
    };

    current.expenses += toNumber(expense.amount);
    trendMap.set(key, current);
  }

  const trends = Array.from(trendMap.values()).sort((a, b) =>
    a.date.localeCompare(b.date)
  );

  const productMap = new Map<
    string,
    {
      productId: string;
      productName: string;
      sku: string | null;
      quantitySold: number;
      grossSales: number;
      costOfGoodsSold: number;
    }
  >();

  for (const sale of sales) {
    for (const item of sale.items) {
      const productId = item.productId.toString();
      const current = productMap.get(productId) || {
        productId,
        productName: item.product.name,
        sku: item.product.sku,
        quantitySold: 0,
        grossSales: 0,
        costOfGoodsSold: 0,
      };

      const quantity = toNumber(item.quantity);

      current.quantitySold += quantity;
      current.grossSales += toNumber(item.unitPrice) * quantity;
      current.costOfGoodsSold += toNumber(item.costPrice) * quantity;

      productMap.set(productId, current);
    }
  }

  const bestSellingProducts = Array.from(productMap.values())
    .sort((a, b) => b.quantitySold - a.quantitySold)
    .slice(0, 10)
    .map((product) => ({
      ...product,
      grossProfit:
        product.grossSales - product.costOfGoodsSold,
    }));

  const paymentMap = new Map<
    string,
    { method: string; amount: number; transactions: number }
  >();

  for (const payment of payments) {
    const method = payment.method || "unknown";
    const current = paymentMap.get(method) || {
      method,
      amount: 0,
      transactions: 0,
    };

    current.amount += toNumber(payment.amount);
    current.transactions += 1;
    paymentMap.set(method, current);
  }

  const paymentMethods = Array.from(paymentMap.values()).sort(
    (a, b) => b.amount - a.amount
  );

  const supplierMap = new Map<
    string,
    { supplierId: string; supplierName: string; purchaseValue: number; amountPaid: number }
  >();

  for (const purchase of purchases) {
    const supplierId = purchase.supplierId.toString();
    const current = supplierMap.get(supplierId) || {
      supplierId,
      supplierName: purchase.supplier.name,
      purchaseValue: 0,
      amountPaid: 0,
    };

    current.purchaseValue += toNumber(purchase.total);
    current.amountPaid += toNumber(purchase.amountPaid);
    supplierMap.set(supplierId, current);
  }

  const purchaseBreakdown = Array.from(supplierMap.values()).sort(
    (a, b) => b.purchaseValue - a.purchaseValue
  );

  const expenseMap = new Map<
    string,
    { category: string; amount: number; transactions: number }
  >();

  for (const expense of expenses) {
    const category = expense.category || "Uncategorized";
    const current = expenseMap.get(category) || {
      category,
      amount: 0,
      transactions: 0,
    };

    current.amount += toNumber(expense.amount);
    current.transactions += 1;
    expenseMap.set(category, current);
  }

  const expenseBreakdown = Array.from(expenseMap.values()).sort(
    (a, b) => b.amount - a.amount
  );

  return {
    period: {
      startDate: range.startDate,
      endDateExclusive: range.endDateExclusive,
      grouping: monthly ? "monthly" : "daily",
    },

    summary: {
      totalSales,
      salesTax,
      netSales,
      totalPayments,
      costOfGoodsSold,
      grossProfit,
      totalExpenses,
      netProfit,
      totalPurchases,
      purchasePayments,
      outstandingSales: sales.reduce(
        (sum, sale) => sum + toNumber(sale.balanceDue),
        0
      ),
      outstandingPurchases: purchases.reduce(
        (sum, purchase) => sum + toNumber(purchase.balanceDue),
        0
      ),
      salesCount: sales.length,
      purchaseCount: purchases.length,
      paymentCount: payments.length,
      expenseCount: expenses.length,
    },

    trends,
    bestSellingProducts,
    paymentMethods,
    purchaseBreakdown,
    expenseBreakdown,
  };
}
