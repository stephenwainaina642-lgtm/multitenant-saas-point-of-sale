import prisma from "../lib/prisma.js";
import { decimalToCents, decimalToMilli, lineAmount } from "../lib/money.js";
import { dayKey, nextDay, startOfDay } from "../lib/timezone.js";

/** All money is summed as integer cents (quantities as thousandths) and converted only for output. */
const out = (c: bigint): number => Number(c) / 100;
const qty = (m: bigint): number => Number(m) / 1000;
const cents = (v: unknown): bigint => decimalToCents(v as string);
const milli = (v: unknown): bigint => decimalToMilli(v as string);
const sum = <T,>(rows: T[], f: (r: T) => bigint) => rows.reduce((t, r) => t + f(r), 0n);

export type DashboardScope = {
  businessId: bigint;
  userId: bigint;
  timeZone: string;
  /** What the caller may see. Sections they may not see come back as null. */
  seeAllSales: boolean;
  seeOwnSales: boolean;
  seeStock: boolean;
  seePayables: boolean;
  now?: Date;
};

const addDays = (dateText: string, n: number): string => {
  let d = dateText;
  for (let i = 0; i < n; i++) d = nextDay(d);
  return d;
};

/** Monday of the week containing `dateText` (YYYY-MM-DD), a pure calendar calculation. */
function weekStart(dateText: string): string {
  const d = new Date(`${dateText}T00:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

type Bucket = { label: string; from: Date; to: Date; total: bigint };

function buildBuckets(today: string, tz: string) {
  const [y, m] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
  const monthName = (mm: number) => new Date(Date.UTC(2000, mm - 1, 1)).toLocaleDateString("en-KE", { month: "short", timeZone: "UTC" });
  const mk = (label: string, fromDay: string, toDay: string): Bucket => ({
    label, from: startOfDay(fromDay, tz), to: startOfDay(toDay, tz), total: 0n,
  });

  const monday = weekStart(today);
  const week: Bucket[] = [];
  for (let i = 0; i < 7; i++) {
    const day = addDays(monday, i);
    week.push(mk(new Date(`${day}T00:00:00Z`).toLocaleDateString("en-KE", { weekday: "short", timeZone: "UTC" }), day, nextDay(day)));
  }

  const monthFirst = `${today.slice(0, 7)}-01`;
  const nextMonthFirst = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  const month: Bucket[] = [];
  for (let w = 0; w < 5; w++) {
    const from = addDays(monthFirst, w * 7);
    if (from >= nextMonthFirst) break;
    const to = addDays(from, 7);
    month.push(mk(`Week ${w + 1}`, from, to < nextMonthFirst ? to : nextMonthFirst));
  }

  const year: Bucket[] = [];
  for (let mm = 1; mm <= 12; mm++) {
    const from = `${y}-${String(mm).padStart(2, "0")}-01`;
    const to = mm === 12 ? `${y + 1}-01-01` : `${y}-${String(mm + 1).padStart(2, "0")}-01`;
    year.push(mk(monthName(mm), from, to));
  }

  return { week, month, year, weekFrom: week[0]!.from, yearFrom: year[0]!.from, yearTo: year[11]!.to, monthFirst, nextMonthFirst };
}

export async function getDashboard(scope: DashboardScope) {
  const now = scope.now ?? new Date();
  const tz = scope.timeZone;
  const today = dayKey(now, tz, false);
  const b = buildBuckets(today, tz);
  const todayStart = startOfDay(today, tz);
  const tomorrowStart = startOfDay(nextDay(today), tz);
  const monthStart = startOfDay(b.monthFirst, tz);
  const monthEnd = startOfDay(b.nextMonthFirst, tz);

  const canSeeSales = scope.seeAllSales || scope.seeOwnSales;
  const saleScope = scope.seeAllSales ? {} : { salespersonId: scope.userId };
  const bid = scope.businessId;

  const [yearSales, receivableSales, recent, products, purchases] = await Promise.all([
    canSeeSales
      ? prisma.sale.findMany({
          where: { businessId: bid, status: "completed", ...saleScope, saleDate: { gte: b.yearFrom, lt: b.yearTo } },
          select: { saleDate: true, total: true },
        })
      : Promise.resolve([]),
    canSeeSales
      ? prisma.sale.findMany({
          where: { businessId: bid, status: "completed", ...saleScope },
          select: {
            id: true, total: true, amountPaid: true, balanceDue: true, salespersonId: true,
            salesperson: { select: { name: true, email: true } },
          },
        })
      : Promise.resolve([]),
    canSeeSales
      ? prisma.sale.findMany({
          where: { businessId: bid, status: "completed", ...saleScope },
          orderBy: [{ saleDate: "desc" }, { id: "desc" }],
          take: 10,
          select: {
            id: true, receiptNumber: true, saleDate: true, total: true, paymentStatus: true, status: true,
            customer: { select: { name: true } },
          },
        })
      : Promise.resolve([]),
    scope.seeStock
      ? prisma.product.findMany({
          where: { businessId: bid, isActive: true },
          select: { id: true, name: true, sku: true, unitOfMeasure: true, stockQuantity: true, minimumStock: true, costPrice: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
    scope.seePayables
      ? prisma.purchase.findMany({
          where: { businessId: bid, status: "received" },
          select: { balanceDue: true },
        })
      : Promise.resolve([]),
  ]);

  // ---- sales: periods and chart series (every figure is the sum of completed sales) ----
  let sales: unknown = null;
  let charts: unknown = null;
  let receivables: unknown = null;
  let performance: unknown = null;
  let recentSales: unknown = null;

  if (canSeeSales) {
    const inRange = (from: Date, to: Date) => yearSales.filter((s) => s.saleDate >= from && s.saleDate < to);
    // Month-to-date may start before the year buckets only if the month began last year: it cannot.
    const todaySales = inRange(todayStart, tomorrowStart);
    const monthSales = inRange(monthStart, monthEnd);
    sales = {
      today: { count: todaySales.length, revenue: out(sum(todaySales, (s) => cents(s.total))) },
      thisMonth: { count: monthSales.length, revenue: out(sum(monthSales, (s) => cents(s.total))) },
      allTime: {
        count: receivableSales.length,
        revenue: out(sum(receivableSales, (s) => cents(s.total))),
      },
    };

    const fill = (buckets: Bucket[]) => {
      for (const s of yearSales) {
        const bucket = buckets.find((x) => s.saleDate >= x.from && s.saleDate < x.to);
        if (bucket) bucket.total += cents(s.total);
      }
      return buckets.map((x) => ({ label: x.label, total: out(x.total) }));
    };
    charts = { week: fill(b.week), month: fill(b.month), year: fill(b.year) };

    const owing = receivableSales.filter((s) => cents(s.balanceDue) > 0n);
    receivables = {
      outstanding: out(sum(owing, (s) => cents(s.balanceDue))),
      unpaidSales: owing.length,
    };

    if (scope.seeAllSales) {
      const map = new Map<string, { id: string; name: string; email: string; salesCount: number; revenue: bigint; collected: bigint; outstanding: bigint }>();
      for (const s of receivableSales) {
        const id = s.salespersonId ? s.salespersonId.toString() : "unassigned";
        const cur = map.get(id) || {
          id, name: s.salesperson?.name || "Unassigned salesperson", email: s.salesperson?.email || "",
          salesCount: 0, revenue: 0n, collected: 0n, outstanding: 0n,
        };
        cur.salesCount += 1;
        cur.revenue += cents(s.total);
        cur.collected += cents(s.amountPaid);
        cur.outstanding += cents(s.balanceDue);
        map.set(id, cur);
      }
      performance = Array.from(map.values())
        .sort((a, c) => (c.revenue > a.revenue ? 1 : c.revenue < a.revenue ? -1 : a.name.localeCompare(c.name)))
        .map((p) => ({ ...p, revenue: out(p.revenue), collected: out(p.collected), outstanding: out(p.outstanding) }));
    }

    recentSales = recent.map((s) => ({
      id: s.id.toString(),
      receiptNumber: s.receiptNumber,
      customerName: s.customer?.name ?? null,
      saleDate: s.saleDate,
      total: out(cents(s.total)),
      paymentStatus: s.paymentStatus,
      status: s.status,
    }));
  }

  // ---- stock ----
  let stock: unknown = null;
  if (scope.seeStock) {
    const stockMilli = sum(products, (p) => milli(p.stockQuantity));
    const stockValue = sum(products, (p) => lineAmount(milli(p.stockQuantity), cents(p.costPrice)));
    const low = products.filter((p) => milli(p.stockQuantity) <= milli(p.minimumStock));
    stock = {
      productCount: products.length,
      units: qty(stockMilli),
      value: out(stockValue),
      lowStockCount: low.length,
      lowStock: low
        .sort((a, c) => (milli(a.stockQuantity) - milli(c.stockQuantity) > 0n ? 1 : -1))
        .slice(0, 20)
        .map((p) => ({
          id: p.id.toString(), name: p.name, sku: p.sku, unitOfMeasure: p.unitOfMeasure,
          stockQuantity: qty(milli(p.stockQuantity)), minimumStock: qty(milli(p.minimumStock)),
        })),
    };
  }

  const payables = scope.seePayables
    ? {
        outstanding: out(sum(purchases.filter((p) => cents(p.balanceDue) > 0n), (p) => cents(p.balanceDue))),
        unpaidPurchases: purchases.filter((p) => cents(p.balanceDue) > 0n).length,
      }
    : null;

  return { timeZone: tz, today, sales, receivables, payables, stock, charts, performance, recentSales };
}
