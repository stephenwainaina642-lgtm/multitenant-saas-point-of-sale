import prisma from "../lib/prisma.js";
import { decimalToCents, decimalToMilli, lineAmount } from "../lib/money.js";
import { dayKey } from "../lib/timezone.js";
import { allocate, enteredSaleDiscount } from "../sales/sale-calc.js";

type Range = { startDate: Date; endDateExclusive: Date; timeZone: string };

const out = (cents: bigint): number => Number(cents) / 100;
const cents = (value: unknown): bigint => decimalToCents(value as string);

type Bucket = { net: bigint; vat: bigint };
const empty = (): Bucket => ({ net: 0n, vat: 0n });

type Totals = {
  standardRated: Bucket; // lines that were charged VAT
  zeroRated: Bucket;
  exempt: Bucket;
  noVatCharged: Bucket; // standard-class products sold with no VAT (e.g. before VAT registration)
  manualTax: bigint; // sale-level tax typed in by hand (only possible when VAT was off)
  salesTotal: bigint;
  inputNet: bigint;
  inputVat: bigint;
  purchasesCount: number;
  salesCount: number;
};
const blank = (): Totals => ({
  standardRated: empty(), zeroRated: empty(), exempt: empty(), noVatCharged: empty(),
  manualTax: 0n, salesTotal: 0n, inputNet: 0n, inputVat: 0n, purchasesCount: 0, salesCount: 0,
});

function present(t: Totals) {
  const outputVat = t.standardRated.vat + t.manualTax;
  const netSales = t.standardRated.net + t.zeroRated.net + t.exempt.net + t.noVatCharged.net;
  return {
    sales: {
      count: t.salesCount,
      standardRated: { netSales: out(t.standardRated.net), vat: out(t.standardRated.vat) },
      zeroRated: { netSales: out(t.zeroRated.net) },
      exempt: { netSales: out(t.exempt.net) },
      noVatCharged: { netSales: out(t.noVatCharged.net) },
      manualTax: out(t.manualTax),
      netSales: out(netSales),
      outputVat: out(outputVat),
      totalIncludingVat: out(t.salesTotal),
    },
    purchases: { count: t.purchasesCount, netPurchases: out(t.inputNet), inputVat: out(t.inputVat) },
    vatPayable: out(outputVat - t.inputVat),
  };
}

/**
 * VAT summary by sale date (VAT on invoice, not on cash received), voided sales excluded.
 * Each completed sale is split exactly the way it was priced: the sale-level discount is shared
 * over the lines with the same largest-remainder rule, so net + VAT adds up to the sale total.
 */
export async function getVatReport(businessId: string, range: Range) {
  const bid = BigInt(businessId);
  const dateFilter = { gte: range.startDate, lt: range.endDateExclusive };

  const [business, sales, purchases] = await Promise.all([
    prisma.business.findUnique({
      where: { id: bid },
      select: { name: true, taxPin: true, vatRegistered: true, vatRate: true, pricesIncludeVat: true },
    }),
    prisma.sale.findMany({
      where: { businessId: bid, status: "completed", saleDate: dateFilter },
      include: { items: { include: { product: { select: { taxClass: true } } } } },
      orderBy: { saleDate: "asc" },
    }),
    prisma.purchase.findMany({
      where: { businessId: bid, status: "received", purchaseDate: dateFilter },
      select: { purchaseDate: true, total: true, tax: true },
    }),
  ]);

  const all = blank();
  const byMonth = new Map<string, Totals>();
  const month = (d: Date) => dayKey(d, range.timeZone, true);
  const bucketFor = (key: string) => {
    let t = byMonth.get(key);
    if (!t) { t = blank(); byMonth.set(key, t); }
    return t;
  };

  for (const sale of sales) {
    const m = bucketFor(month(sale.saleDate));
    const bases = sale.items.map((i) => lineAmount(decimalToMilli(i.quantity), cents(i.unitPrice)) - cents(i.discount));
    const shares = allocate(enteredSaleDiscount(sale), bases);
    let lineTax = 0n;
    sale.items.forEach((item, idx) => {
      const tax = cents(item.tax);
      lineTax += tax;
      const after = bases[idx]! - shares[idx]!;
      const net = sale.pricesIncludeVat ? after - tax : after; // inclusive: the VAT is inside `after`
      const cls = tax > 0n ? "standardRated"
        : item.product.taxClass === "zero_rated" ? "zeroRated"
        : item.product.taxClass === "exempt" ? "exempt"
        : "noVatCharged";
      for (const t of [all, m]) { t[cls].net += net; t[cls].vat += tax; }
    });
    const manual = cents(sale.tax) - lineTax;
    for (const t of [all, m]) {
      t.manualTax += manual;
      t.salesTotal += cents(sale.total);
      t.salesCount += 1;
    }
  }

  for (const p of purchases) {
    const tax = cents(p.tax);
    for (const t of [all, bucketFor(month(p.purchaseDate))]) {
      t.inputVat += tax;
      t.inputNet += cents(p.total) - tax;
      t.purchasesCount += 1;
    }
  }

  return {
    business: {
      name: business?.name ?? "",
      taxPin: business?.taxPin ?? null,
      vatRegistered: business?.vatRegistered ?? false,
      vatRate: business?.vatRate.toFixed(2) ?? "16.00",
      pricesIncludeVat: business?.pricesIncludeVat ?? false,
    },
    period: { timeZone: range.timeZone },
    ...present(all),
    byMonth: [...byMonth.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([key, t]) => ({ month: key, ...present(t) })),
    notes: [
      "Based on completed sales by sale date; a sale voided later disappears from its original month (no credit-note adjustment is made).",
      "Zero-rated and exempt lines are classified by the product's current VAT class.",
      "Input VAT is whatever tax was entered on received purchases; supplier VAT invoices are not validated.",
      "This is a summary to help prepare a VAT return. It is not a filed return and is not connected to KRA or eTIMS.",
    ],
  };
}
