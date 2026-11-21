import prisma from "../lib/prisma.js";
import { AppError } from "../lib/errors.js";
import {
  decimalToCents,
  lineAmount,
  parseMoney,
  parseQuantity,
} from "../lib/money.js";

export type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export type RawSaleItem = {
  productId: string;
  quantity: number;
  unitPrice: number;
  discount?: number;
  tax?: number;
};

export type SaleLine = {
  productId: bigint;
  productName: string;
  quantity: bigint; // thousandths
  unitPrice: bigint; // cents
  costPrice: bigint; // cents
  discount: bigint;
  tax: bigint;
  total: bigint;
  taxClass: string;
  /** The rate this line was charged at (basis points of a percent, 1600 = 16%); set when VAT is applied. */
  rateBps?: bigint;
};

type LineOptions = {
  /**
   * Editing: products already on the sale. They stay valid even if archived,
   * and their original unit price stays acceptable if the catalogue price has
   * since changed.
   */
  existing?: Map<bigint, Set<bigint>>;
};

/** Validate raw items against the catalogue and price them exactly. */
export async function buildSaleLines(
  tx: Tx,
  businessId: bigint,
  items: RawSaleItem[],
  options: LineOptions = {}
): Promise<SaleLine[]> {
  const lines: SaleLine[] = [];

  for (const item of items) {
    const quantity = parseQuantity(item.quantity, "Quantity");
    const unitPrice = parseMoney(item.unitPrice, "Unit price");
    const discount = parseMoney(item.discount ?? 0, "Discount");
    const tax = parseMoney(item.tax ?? 0, "Tax");

    if (quantity <= 0n) {
      throw new AppError(400, "Quantity must be greater than zero");
    }
    if (unitPrice < 0n) {
      throw new AppError(400, "Unit price cannot be negative");
    }
    if (discount < 0n) {
      throw new AppError(400, "Discount cannot be negative");
    }
    if (tax < 0n) {
      throw new AppError(400, "Tax cannot be negative");
    }

    let productId: bigint;
    try {
      productId = BigInt(item.productId);
    } catch {
      throw new AppError(404, `Product not found: ${item.productId}`);
    }

    const keptFromSale = options.existing?.has(productId) ?? false;

    const product = await tx.product.findFirst({
      where: {
        id: productId,
        businessId,
        ...(!keptFromSale && { isActive: true }),
      },
    });

    if (!product) {
      throw new AppError(404, `Product not found: ${item.productId}`);
    }

    const catalogueOk = unitPrice === decimalToCents(product.sellingPrice);
    const originalOk = options.existing?.get(productId)?.has(unitPrice) ?? false;

    if (!catalogueOk && !originalOk) {
      throw new AppError(
        400,
        `Sale price does not match the saved selling price for: ${product.name}`
      );
    }

    const lineTotal = lineAmount(quantity, unitPrice) - discount + tax;

    if (lineTotal < 0n) {
      throw new AppError(400, "Item total cannot be negative");
    }

    lines.push({
      productId: product.id,
      productName: product.name,
      quantity,
      unitPrice,
      costPrice: decimalToCents(product.costPrice),
      discount,
      tax,
      total: lineTotal,
      taxClass: product.taxClass,
    });
  }

  return lines;
}

/**
 * subtotal = gross of all lines; discount and tax include both the line-level
 * and the sale-level amounts, so total = subtotal - discount + tax always holds.
 */
export function computeSaleTotals(
  lines: SaleLine[],
  saleDiscountInput: unknown,
  saleTaxInput: unknown
) {
  const saleDiscount = parseMoney(saleDiscountInput ?? 0, "Sale discount");
  const saleTax = parseMoney(saleTaxInput ?? 0, "Sale tax");

  if (saleDiscount < 0n) {
    throw new AppError(400, "Sale discount cannot be negative");
  }
  if (saleTax < 0n) {
    throw new AppError(400, "Sale tax cannot be negative");
  }

  const subtotal = lines.reduce(
    (sum, l) => sum + lineAmount(l.quantity, l.unitPrice),
    0n
  );
  const discount = lines.reduce((sum, l) => sum + l.discount, saleDiscount);
  const tax = lines.reduce((sum, l) => sum + l.tax, saleTax);
  const total = subtotal - discount + tax;

  if (total < 0n) {
    throw new AppError(400, "Sale total cannot be negative");
  }

  return { subtotal, discount, tax, total };
}

/** Sum quantities per product, ordered by id (stable lock order). */
export function aggregateByProduct(
  lines: { productId: bigint; productName?: string; quantity: bigint }[]
) {
  const map = new Map<bigint, { name: string; quantity: bigint }>();

  for (const l of lines) {
    const entry = map.get(l.productId);
    if (entry) entry.quantity += l.quantity;
    else map.set(l.productId, { name: l.productName ?? "", quantity: l.quantity });
  }

  return [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

// ---------------------------------------------------------------------------------------------
// VAT (exclusive pricing: VAT is added on top of the selling price)
// ---------------------------------------------------------------------------------------------

/** `inclusive`: entered prices already contain VAT (only ever true when `registered`). */
export type Vat = { registered: boolean; rateBps: bigint; inclusive: boolean; custom: Map<string, bigint> };

/** standard = the business rate; zero_rated and exempt = 0; any other class is one of the business's own rates. */
export function rateFor(vat: Vat, taxClass: string): bigint {
  if (taxClass === "standard") return vat.rateBps;
  return vat.custom.get(taxClass) ?? 0n;
}

export async function loadVat(tx: Tx, businessId: bigint): Promise<Vat> {
  const b = await tx.business.findUnique({
    where: { id: businessId },
    select: { vatRegistered: true, vatRate: true, pricesIncludeVat: true },
  });
  const registered = b?.vatRegistered ?? false;
  const extra = registered ? await tx.taxRate.findMany({ where: { businessId }, select: { code: true, rate: true } }) : [];
  return {
    registered,
    rateBps: decimalToCents(b?.vatRate ?? 0),
    inclusive: registered && (b?.pricesIncludeVat ?? false),
    custom: new Map(extra.map((r) => [r.code, decimalToCents(r.rate)])),
  };
}

/**
 * Spread `amount` over `weights` so the parts add up to exactly `amount`
 * (largest remainder, ties to the earlier line).
 */
export function allocate(amount: bigint, weights: bigint[]): bigint[] {
  const total = weights.reduce((a, w) => a + w, 0n);
  if (amount === 0n || total === 0n) return weights.map(() => 0n);
  const parts = weights.map((w) => (amount * w) / total);
  let left = amount - parts.reduce((a, p) => a + p, 0n);
  const order = weights
    .map((w, i) => ({ i, rem: (amount * w) % total }))
    .sort((a, b) => (a.rem === b.rem ? a.i - b.i : a.rem > b.rem ? -1 : 1));
  for (let k = 0; left > 0n && k < order.length; k++, left--) parts[order[k]!.i] = parts[order[k]!.i]! + 1n;
  return parts;
}

/**
 * When the business is VAT registered the server works out each line's VAT itself:
 * standard-rated lines pay `rate` on (line amount - line discount - its share of the
 * sale-level discount), rounded half up per line; zero-rated and exempt lines pay none.
 * Anything the client sent as tax is ignored.
 */
export function applyVat(lines: SaleLine[], saleDiscount: bigint, vat: Vat): void {
  if (!vat.registered) return;
  const bases = lines.map((l) => lineAmount(l.quantity, l.unitPrice) - l.discount);
  if (bases.some((b) => b < 0n)) throw new AppError(400, "Item total cannot be negative");
  const baseTotal = bases.reduce((a, b) => a + b, 0n);
  if (saleDiscount > baseTotal) throw new AppError(400, "Sale discount cannot exceed the sale amount");
  const shares = allocate(saleDiscount, bases);
  lines.forEach((l, i) => {
    const net = bases[i]! - shares[i]!;
    const rate = rateFor(vat, l.taxClass);
    l.rateBps = rate;
    l.tax = (net * rate + 5000n) / 10000n;
    l.total = lineAmount(l.quantity, l.unitPrice) - l.discount + l.tax;
  });
}

/**
 * The sale-level discount as it was entered, recovered from stored figures:
 * VAT-inclusive documents: sum(line totals) - total (line totals are before the sale discount);
 * VAT-exclusive documents: header discount minus the lines'' own discounts.
 */
export function enteredSaleDiscount(doc: {
  pricesIncludeVat: boolean;
  discount: unknown;
  total: unknown;
  items: { discount: unknown; total: unknown }[];
}): bigint {
  const items = doc.items;
  const value = doc.pricesIncludeVat
    ? items.reduce((t, i) => t + decimalToCents(i.total as never), 0n) - decimalToCents(doc.total as never)
    : decimalToCents(doc.discount as never) - items.reduce((t, i) => t + decimalToCents(i.discount as never), 0n);
  return value < 0n ? 0n : value;
}

/** The VAT-free part of a VAT-inclusive amount, rounded half up. The VAT is always `gross - net`. */
export function netOfInclusive(gross: bigint, rateBps: bigint): bigint {
  const divisor = 10000n + rateBps;
  return (gross * 10000n + divisor / 2n) / divisor;
}

/**
 * VAT-inclusive pricing. Entered prices and discounts contain VAT. Per standard-rated line:
 * gross = qty x price - line discount - its share of the sale discount, net = gross without VAT
 * (half up), tax = gross - net, so net + tax equals gross exactly and no unit price is ever
 * derived. line.total stays "amount after the line's own discount" (tax inside it).
 *
 * Sale columns keep total = subtotal - discount + tax: subtotal is the VAT-free value before any
 * discount, tax the sum of line VAT, total the sum of gross, and discount the VAT-free discount
 * (the remainder), so the existing database rule holds with no change.
 */
export function applyInclusiveVat(lines: SaleLine[], saleDiscount: bigint, vat: Vat) {
  const gross = lines.map((l) => lineAmount(l.quantity, l.unitPrice) - l.discount);
  if (gross.some((g) => g < 0n)) throw new AppError(400, "Item total cannot be negative");
  const grossTotal = gross.reduce((a, g) => a + g, 0n);
  if (saleDiscount > grossTotal) throw new AppError(400, "Sale discount cannot exceed the sale amount");
  const shares = allocate(saleDiscount, gross);

  let subtotal = 0n;
  let tax = 0n;
  let total = 0n;
  lines.forEach((l, i) => {
    const rate = rateFor(vat, l.taxClass);
    l.rateBps = rate;
    const after = gross[i]! - shares[i]!;
    const net = netOfInclusive(after, rate);
    l.tax = after - net;
    l.total = gross[i]!;
    const before = lineAmount(l.quantity, l.unitPrice);
    subtotal += netOfInclusive(before, rate);
    tax += l.tax;
    total += after;
  });
  const discount = subtotal + tax - total;
  if (discount < 0n) throw new AppError(400, "Discount could not be applied");
  return { subtotal, discount, tax, total };
}

/** Lines and totals for a new or edited sale, or a quotation, with VAT when the business has it on. */
export async function priceSale(
  tx: Tx,
  businessId: bigint,
  items: RawSaleItem[],
  saleDiscountInput: unknown,
  saleTaxInput: unknown,
  options: LineOptions & { pricesIncludeVat?: boolean } = {}
) {
  const lines = await buildSaleLines(tx, businessId, items, options);
  const vat = await loadVat(tx, businessId);
  // A stored document keeps the mode it was priced in (editing, converting a quotation).
  if (vat.registered && options.pricesIncludeVat !== undefined) vat.inclusive = options.pricesIncludeVat;
  if (vat.registered) {
    const saleDiscount = parseMoney(saleDiscountInput ?? 0, "Sale discount");
    if (saleDiscount < 0n) throw new AppError(400, "Sale discount cannot be negative");
    if (vat.inclusive) return { lines, totals: applyInclusiveVat(lines, saleDiscount, vat), vat };
    applyVat(lines, saleDiscount, vat);
  }
  const totals = computeSaleTotals(lines, saleDiscountInput, vat.registered ? 0 : saleTaxInput);
  return { lines, totals, vat };
}
