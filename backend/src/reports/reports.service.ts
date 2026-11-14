import prisma from "../lib/prisma.js";
import { decimalToCents, decimalToMilli, lineAmount } from "../lib/money.js";
import { dayKey } from "../lib/timezone.js";

type ReportDateRange = {
  startDate: Date;
  endDateExclusive: Date;
  timeZone: string;
};

/** All money is summed as integer cents and only converted to a number for output. */
const out = (cents: bigint): number => Number(cents) / 100;
const cents = (value: unknown): bigint => decimalToCents(value as string);

export async function getBusinessReports(
  businessId: string,
  range: ReportDateRange
) {
  const businessFilter = BigInt(businessId);

  const dateFilter = {
    gte: range.startDate,
    lt: range.endDateExclusive,
  };

  const [sales, payments, purchases, expenses, refunds, supplierPayments] = await Promise.all([
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
        sale: { status: "completed" },
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

    prisma.refund.findMany({
      where: { businessId: businessFilter, createdAt: dateFilter },
    }),

    prisma.supplierPayment.findMany({
      where: { businessId: businessFilter, paymentDate: dateFilter, purchase: { status: "received" } },
    }),
  ]);

  const sum = <T,>(rows: T[], f: (r: T) => bigint) => rows.reduce((t, r) => t + f(r), 0n);

  const totalSales = sum(sales, (sale) => cents(sale.total));
  const salesTax = sum(sales, (sale) => cents(sale.tax));
  const netSales = totalSales - salesTax;
  const itemCost = (item: { costPrice: unknown; quantity: unknown }) =>
    lineAmount(decimalToMilli(item.quantity as string), cents(item.costPrice));
  const costOfGoodsSold = sum(sales, (sale) => sum(sale.items, itemCost));
  const grossProfit = netSales - costOfGoodsSold;
  const totalPayments = sum(payments, (payment) => cents(payment.amount));
  const totalRefunds = sum(refunds, (refund) => cents(refund.amount));
  const totalExpenses = sum(expenses, (expense) => cents(expense.amount));
  const netProfit = grossProfit - totalExpenses;
  const totalPurchases = sum(purchases, (purchase) => cents(purchase.total));
  const purchasePayments = sum(purchases, (purchase) => cents(purchase.amountPaid));
  const supplierPaymentsMade = sum(supplierPayments, (payment) => cents(payment.amount));

  const monthly =
    range.endDateExclusive.getTime() - range.startDate.getTime() >
    62 * 24 * 60 * 60 * 1000;

  const trendMap = new Map<
    string,
    { date: string; revenue: bigint; expenses: bigint }
  >();

  for (const sale of sales) {
    const key = dayKey(sale.saleDate, range.timeZone, monthly);
    const current = trendMap.get(key) || {
      date: key,
      revenue: 0n,
      expenses: 0n,
    };

    current.revenue += cents(sale.total) - cents(sale.tax);
    trendMap.set(key, current);
  }

  for (const expense of expenses) {
    const key = dayKey(expense.expenseDate, range.timeZone, monthly);
    const current = trendMap.get(key) || {
      date: key,
      revenue: 0n,
      expenses: 0n,
    };

    current.expenses += cents(expense.amount);
    trendMap.set(key, current);
  }

  const trends = Array.from(trendMap.values())
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((t) => ({ date: t.date, revenue: out(t.revenue), expenses: out(t.expenses) }));

  const productMap = new Map<
    string,
    {
      productId: string;
      productName: string;
      sku: string | null;
      quantitySold: bigint;
      grossSales: bigint;
      costOfGoodsSold: bigint;
    }
  >();

  for (const sale of sales) {
    for (const item of sale.items) {
      const productId = item.productId.toString();
      const current = productMap.get(productId) || {
        productId,
        productName: item.product.name,
        sku: item.product.sku,
        quantitySold: 0n,
        grossSales: 0n,
        costOfGoodsSold: 0n,
      };

      current.quantitySold += decimalToMilli(item.quantity);
      // Net of the line's own discount and tax, so it adds up to net sales.
      current.grossSales += cents(item.total) - cents(item.tax);
      current.costOfGoodsSold += itemCost(item);

      productMap.set(productId, current);
    }
  }

  const bestSellingProducts = Array.from(productMap.values())
    .sort((a, b) => (b.quantitySold > a.quantitySold ? 1 : b.quantitySold < a.quantitySold ? -1 : 0))
    .slice(0, 10)
    .map((product) => ({
      productId: product.productId,
      productName: product.productName,
      sku: product.sku,
      quantitySold: Number(product.quantitySold) / 1000,
      grossSales: out(product.grossSales),
      costOfGoodsSold: out(product.costOfGoodsSold),
      grossProfit: out(product.grossSales - product.costOfGoodsSold),
    }));

  const paymentMap = new Map<
    string,
    { method: string; amount: bigint; transactions: number }
  >();

  for (const payment of payments) {
    const method = payment.method || "unknown";
    const current = paymentMap.get(method) || {
      method,
      amount: 0n,
      transactions: 0,
    };

    current.amount += cents(payment.amount);
    current.transactions += 1;
    paymentMap.set(method, current);
  }

  const paymentMethods = Array.from(paymentMap.values())
    .sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0))
    .map((m) => ({ ...m, amount: out(m.amount) }));

  const supplierMap = new Map<
    string,
    { supplierId: string; supplierName: string; purchaseValue: bigint; amountPaid: bigint }
  >();

  for (const purchase of purchases) {
    const supplierId = purchase.supplierId.toString();
    const current = supplierMap.get(supplierId) || {
      supplierId,
      supplierName: purchase.supplier.name,
      purchaseValue: 0n,
      amountPaid: 0n,
    };

    current.purchaseValue += cents(purchase.total);
    current.amountPaid += cents(purchase.amountPaid);
    supplierMap.set(supplierId, current);
  }

  const purchaseBreakdown = Array.from(supplierMap.values())
    .sort((a, b) => (b.purchaseValue > a.purchaseValue ? 1 : b.purchaseValue < a.purchaseValue ? -1 : 0))
    .map((x) => ({ ...x, purchaseValue: out(x.purchaseValue), amountPaid: out(x.amountPaid) }));

  const expenseMap = new Map<
    string,
    { category: string; amount: bigint; transactions: number }
  >();

  for (const expense of expenses) {
    const category = expense.category || "Uncategorized";
    const current = expenseMap.get(category) || {
      category,
      amount: 0n,
      transactions: 0,
    };

    current.amount += cents(expense.amount);
    current.transactions += 1;
    expenseMap.set(category, current);
  }

  const expenseBreakdown = Array.from(expenseMap.values())
    .sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0))
    .map((e) => ({ ...e, amount: out(e.amount) }));

  return {
    period: {
      startDate: range.startDate,
      endDateExclusive: range.endDateExclusive,
      grouping: monthly ? "monthly" : "daily",
      timeZone: range.timeZone,
    },

    summary: {
      totalSales: out(totalSales),
      salesTax: out(salesTax),
      netSales: out(netSales),
      totalPayments: out(totalPayments),
      refundsIssued: out(totalRefunds),
      costOfGoodsSold: out(costOfGoodsSold),
      grossProfit: out(grossProfit),
      totalExpenses: out(totalExpenses),
      netProfit: out(netProfit),
      totalPurchases: out(totalPurchases),
      purchasePayments: out(purchasePayments),
      supplierPaymentsMade: out(supplierPaymentsMade),
      outstandingSales: out(sum(sales, (sale) => cents(sale.balanceDue))),
      outstandingPurchases: out(sum(purchases, (purchase) => cents(purchase.balanceDue))),
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
