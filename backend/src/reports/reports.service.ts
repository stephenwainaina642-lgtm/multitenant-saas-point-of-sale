import prisma from "../lib/prisma.js";
import { decimalToCents, decimalToMilli, lineAmount } from "../lib/money.js";
import { dayKey } from "../lib/timezone.js";

type ReportDateRange = {
  startDate: Date;
  endDateExclusive: Date;
  timeZone: string;
  /** Report on one branch only; omitted = the whole business. */
  branchId?: bigint | undefined;
};

const RECORD_LIMIT = 1000;

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
        ...(range.branchId && { branchId: range.branchId }),
      },
      include: {
        customer: { select: { name: true } },
        items: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                sku: true,
                category: { select: { publicId: true, name: true } },
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
        // Cash basis: every payment received counts, including ones on sales that were
        // voided later. The matching refund is reported separately as refundsIssued.
        paymentDate: dateFilter,
        ...(range.branchId && { sale: { branchId: range.branchId } }),
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
        ...(range.branchId && { branchId: range.branchId }),
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
        ...(range.branchId && { branchId: range.branchId }),
      },
      orderBy: {
        expenseDate: "asc",
      },
    }),

    prisma.refund.findMany({
      where: { businessId: businessFilter, createdAt: dateFilter, ...(range.branchId && { sale: { branchId: range.branchId } }) },
    }),

    prisma.supplierPayment.findMany({
      where: { businessId: businessFilter, paymentDate: dateFilter, purchase: { status: "received", ...(range.branchId && { branchId: range.branchId }) } },
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

  // Same net figures as the product table, grouped by the product's current category.
  const categoryMap = new Map<string, { categoryId: string | null; categoryName: string; netSales: bigint; costOfGoodsSold: bigint }>();
  for (const sale of sales) {
    for (const item of sale.items) {
      const categoryId = item.product.category?.publicId ?? null;
      const key = categoryId ?? "none";
      const current = categoryMap.get(key) || {
        categoryId,
        categoryName: item.product.category?.name ?? "Uncategorized",
        netSales: 0n,
        costOfGoodsSold: 0n,
      };
      current.netSales += cents(item.total) - cents(item.tax);
      current.costOfGoodsSold += itemCost(item);
      categoryMap.set(key, current);
    }
  }
  // How the sales were made (walk-in, online, ...), on the same net-of-VAT basis.
  const channelMap = new Map<string, { channel: string; count: number; netSales: bigint }>();
  for (const sale of sales) {
    const current = channelMap.get(sale.channel) || { channel: sale.channel, count: 0, netSales: 0n };
    current.count += 1;
    current.netSales += cents(sale.total) - cents(sale.tax);
    channelMap.set(sale.channel, current);
  }
  const salesByChannel = Array.from(channelMap.values())
    .sort((a, b) => (b.netSales > a.netSales ? 1 : b.netSales < a.netSales ? -1 : 0))
    .map((c) => ({ channel: c.channel, salesCount: c.count, netSales: out(c.netSales) }));

  const salesByCategory = Array.from(categoryMap.values())
    .sort((a, b) => (b.netSales > a.netSales ? 1 : b.netSales < a.netSales ? -1 : 0))
    .map((c) => ({
      categoryId: c.categoryId,
      categoryName: c.categoryName,
      netSales: out(c.netSales),
      costOfGoodsSold: out(c.costOfGoodsSold),
      grossProfit: out(c.netSales - c.costOfGoodsSold),
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

  const debts = await debtReport(businessFilter, range);

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

    // The rows behind the numbers, newest first, capped so a huge period stays fast.
    // The summary above always covers every row; `truncated` says if the lists do not.
    records: {
      limit: RECORD_LIMIT,
      truncated:
        sales.length > RECORD_LIMIT || purchases.length > RECORD_LIMIT || expenses.length > RECORD_LIMIT,
      sales: [...sales].reverse().slice(0, RECORD_LIMIT).map((sale) => ({
        id: sale.id.toString(),
        receiptNumber: sale.receiptNumber,
        customerName: sale.customer?.name ?? null,
        saleDate: sale.saleDate,
        total: out(cents(sale.total)),
        amountPaid: out(cents(sale.amountPaid)),
        balanceDue: out(cents(sale.balanceDue)),
        paymentStatus: sale.paymentStatus,
        status: sale.status,
      })),
      purchases: [...purchases].reverse().slice(0, RECORD_LIMIT).map((purchase) => ({
        id: purchase.id.toString(),
        supplierName: purchase.supplier.name,
        invoiceNumber: purchase.invoiceNumber,
        purchaseDate: purchase.purchaseDate,
        total: out(cents(purchase.total)),
        amountPaid: out(cents(purchase.amountPaid)),
        balanceDue: out(cents(purchase.balanceDue)),
        status: purchase.status,
      })),
      expenses: [...expenses].reverse().slice(0, RECORD_LIMIT).map((expense) => ({
        id: expense.id.toString(),
        category: expense.category,
        description: expense.description,
        expenseDate: expense.expenseDate,
        paymentMethod: expense.paymentMethod,
        reference: expense.reference,
        amount: out(cents(expense.amount)),
      })),
    },

    trends,
    bestSellingProducts,
    salesByCategory,
    salesByChannel,
    debts,
    paymentMethods,
    purchaseBreakdown,
    expenseBreakdown,
  };
}


type DebtRow = { customer_id: bigint | null; name: string | null; owed: string; oldest: Date; sales: bigint };

/**
 * Customer debt. "Outstanding" is as of now (a debt does not depend on the report period);
 * "newDebt" and "collected" are for the period. Days are counted in the business time zone.
 */
async function debtReport(businessId: bigint, range: ReportDateRange) {
  const tz = range.timeZone;
  const branch = range.branchId ?? null;
  const rows = await prisma.$queryRaw<DebtRow[]>`
    select s.customer_id, c.name, sum(s.balance_due)::text as owed, min(s.sale_date) as oldest, count(*) as sales
      from sales s left join customers c on c.id = s.customer_id
     where s.business_id = ${businessId} and s.status = 'completed' and s.balance_due > 0
       and (${branch}::bigint is null or s.branch_id = ${branch}::bigint)
     group by s.customer_id, c.name
     order by sum(s.balance_due) desc`;
  const aging = await prisma.$queryRaw<{ bucket: string; owed: string }[]>`
    select case when age <= 30 then 'days0to30' when age <= 60 then 'days31to60' else 'days61plus' end as bucket,
           sum(balance_due)::text as owed
      from (select balance_due,
                   ((now() at time zone ${tz})::date - (sale_date at time zone ${tz})::date) as age
              from sales
             where business_id = ${businessId} and status = 'completed' and balance_due > 0
               and (${branch}::bigint is null or branch_id = ${branch}::bigint)) x
     group by 1`;
  const collected = await prisma.$queryRaw<{ amount: string; payments: bigint }[]>`
    select coalesce(sum(p.amount), 0)::text as amount, count(*) as payments
      from payments p join sales s on s.id = p.sale_id
     where p.business_id = ${businessId}
       and (${branch}::bigint is null or s.branch_id = ${branch}::bigint)
       and p.payment_date >= ${range.startDate} and p.payment_date < ${range.endDateExclusive}
       and (p.payment_date at time zone ${tz})::date > (s.sale_date at time zone ${tz})::date`;
  const created = await prisma.$queryRaw<{ amount: string }[]>`
    select coalesce(sum(s.total - coalesce((
             select sum(p.amount) from payments p
              where p.sale_id = s.id
                and (p.payment_date at time zone ${tz})::date <= (s.sale_date at time zone ${tz})::date), 0)), 0)::text as amount
      from sales s
     where s.business_id = ${businessId} and s.status = 'completed'
       and (${branch}::bigint is null or s.branch_id = ${branch}::bigint)
       and s.sale_date >= ${range.startDate} and s.sale_date < ${range.endDateExclusive}`;

  let total = 0n;
  const customers = rows.map((r) => {
    const owed = decimalToCents(r.owed);
    total += owed;
    return {
      customerId: r.customer_id?.toString() ?? null,
      customerName: r.name ?? "Walk-in (no customer on record)",
      unpaidSales: Number(r.sales),
      owed: out(owed),
      oldestSaleDate: r.oldest,
    };
  });
  const bucket = (b: string) => out(decimalToCents(aging.find((a) => a.bucket === b)?.owed ?? "0"));
  return {
    totalOutstanding: out(total),
    aging: { days0to30: bucket("days0to30"), days31to60: bucket("days31to60"), days61plus: bucket("days61plus") },
    customers,
    newDebtInPeriod: out(decimalToCents(created[0]?.amount ?? "0")),
    collectedInPeriod: out(decimalToCents(collected[0]?.amount ?? "0")),
    collectionPayments: Number(collected[0]?.payments ?? 0),
  };
}
