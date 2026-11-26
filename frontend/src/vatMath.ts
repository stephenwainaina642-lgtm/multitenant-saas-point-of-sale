/**
 * VAT worked out on the device, for selling with no connection. This is a line-for-line port of the server's
 * `backend/src/sales/sale-calc.ts` (applyVat, applyInclusiveVat, allocate, netOfInclusive, lineAmount) using the same
 * integer arithmetic (cents and thousandths), so both sides always agree to the cent. A parity test
 * (`backend/tests/unit/vat-parity.test.ts`) runs both on thousands of random sales and fails if they ever differ.
 * The server still works out VAT itself when the sale arrives; this is only what the cashier sees and what the
 * customer's receipt says while offline. Keep this file free of imports so the backend test can load it.
 */

export type VatSettings = {
  registered: boolean;
  /** The business's standard rate in percent, e.g. "16.00". */
  rate: string;
  inclusive: boolean;
  /** Extra rates by code, in percent, e.g. { reduced: "8.00" }. */
  custom?: Record<string, string>;
};

export type VatLineInput = { quantity: number; unitPrice: number; taxClass?: string };
export type VatResult = { subtotal: bigint; discount: bigint; tax: bigint; total: bigint; lineTax: bigint[] };

/** "16.00" or 16 -> 1600 (basis points of a percent), exactly like the server's decimalToCents. */
export function percentToBps(value: string | number): bigint {
  return BigInt(Number(value).toFixed(2).replace(".", ""));
}
export const toCents = (amount: number | string): bigint => BigInt(Number(amount).toFixed(2).replace(".", ""));
export const toMilli = (quantity: number | string): bigint => BigInt(Number(quantity).toFixed(3).replace(".", ""));
export const centsToNumber = (cents: bigint): number => Number(cents) / 100;

function lineAmount(quantityMilli: bigint, unitCents: bigint): bigint {
  const product = quantityMilli * unitCents;
  const negative = product < 0n;
  const abs = negative ? -product : product;
  const rounded = (abs + 500n) / 1000n;
  return negative ? -rounded : rounded;
}

function allocate(amount: bigint, weights: bigint[]): bigint[] {
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

function netOfInclusive(gross: bigint, rateBps: bigint): bigint {
  const divisor = 10000n + rateBps;
  return (gross * 10000n + divisor / 2n) / divisor;
}

function rateFor(vat: VatSettings, taxClass: string): bigint {
  if (taxClass === "standard") return percentToBps(vat.rate);
  const custom = vat.custom?.[taxClass];
  return custom === undefined ? 0n : percentToBps(custom);
}

/**
 * VAT and totals for a VAT-registered business. Throws Error with a plain message when the sale cannot be priced
 * (discount larger than the sale, a negative line).
 */
export function computeVat(items: VatLineInput[], saleDiscount: number | string, vat: VatSettings): VatResult {
  const discountCents = toCents(saleDiscount || 0);
  if (discountCents < 0n) throw new Error("Sale discount cannot be negative");
  const gross = items.map((l) => lineAmount(toMilli(l.quantity), toCents(l.unitPrice)));
  const grossTotal = gross.reduce((a, g) => a + g, 0n);
  if (discountCents > grossTotal) throw new Error("Sale discount cannot exceed the sale amount");
  const shares = allocate(discountCents, gross);
  const rates = items.map((l) => rateFor(vat, l.taxClass ?? "standard"));

  if (vat.inclusive) {
    let subtotal = 0n;
    let tax = 0n;
    let total = 0n;
    const lineTax: bigint[] = [];
    items.forEach((_, i) => {
      const after = gross[i]! - shares[i]!;
      const net = netOfInclusive(after, rates[i]!);
      lineTax.push(after - net);
      subtotal += netOfInclusive(gross[i]!, rates[i]!);
      tax += after - net;
      total += after;
    });
    const discount = subtotal + tax - total;
    if (discount < 0n) throw new Error("Discount could not be applied");
    return { subtotal, discount, tax, total, lineTax };
  }

  let tax = 0n;
  const lineTax = items.map((_, i) => {
    const net = gross[i]! - shares[i]!;
    const t = (net * rates[i]! + 5000n) / 10000n;
    tax += t;
    return t;
  });
  return { subtotal: grossTotal, discount: discountCents, tax, total: grossTotal - discountCents + tax, lineTax };
}
