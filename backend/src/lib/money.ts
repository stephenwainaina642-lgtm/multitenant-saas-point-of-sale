import { AppError } from "./errors.js";

/**
 * Exact money and quantity arithmetic.
 *
 * Money is handled as integer cents (bigint) and quantities as integer
 * thousandths (bigint). Nothing here touches floating-point arithmetic, so
 * totals, balances and "is it fully paid" checks are exact.
 */

type DecimalLike = { toFixed(digits: number): string };

function parseScaled(
  value: unknown,
  field: string,
  decimals: number
): bigint {
  let text: string;

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new AppError(400, `${field} must be a valid number`);
    }
    const scaled = value * 10 ** decimals;
    if (Math.abs(scaled - Math.round(scaled)) > 1e-6) {
      throw new AppError(
        400,
        `${field} must have at most ${decimals} decimal places`
      );
    }
    text = value.toFixed(decimals);
  } else if (typeof value === "string") {
    const trimmed = value.trim();
    const pattern = new RegExp(`^-?\\d+(\\.\\d{1,${decimals}})?$`);
    if (!pattern.test(trimmed)) {
      throw new AppError(
        400,
        `${field} must be a number with at most ${decimals} decimal places`
      );
    }
    text = trimmed;
  } else {
    throw new AppError(400, `${field} must be a valid number`);
  }

  const negative = text.startsWith("-");
  const [whole = "0", fraction = ""] = text.replace("-", "").split(".");
  const digits = BigInt(whole + fraction.padEnd(decimals, "0"));
  return negative ? -digits : digits;
}

/** Parse a money amount (max 2 decimal places) into cents. */
export function parseMoney(value: unknown, field: string): bigint {
  return parseScaled(value, field, 2);
}

/** Parse a quantity (max 3 decimal places) into thousandths. */
export function parseQuantity(value: unknown, field: string): bigint {
  return parseScaled(value, field, 3);
}

function fromDecimal(value: DecimalLike | string | number, decimals: number) {
  const text =
    typeof value === "object" ? value.toFixed(decimals) : Number(value).toFixed(decimals);
  return BigInt(text.replace(".", ""));
}

/** Convert a Prisma Decimal (money) to cents. */
export function decimalToCents(value: DecimalLike | string | number): bigint {
  return fromDecimal(value, 2);
}

/** Convert a Prisma Decimal (quantity) to thousandths. */
export function decimalToMilli(value: DecimalLike | string | number): bigint {
  return fromDecimal(value, 3);
}

function format(value: bigint, decimals: number): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals);
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

/** Cents -> "1234.50" (a string Prisma accepts for Decimal columns). */
export function centsToString(cents: bigint): string {
  return format(cents, 2);
}

/** Thousandths -> "2.500". */
export function milliToString(milli: bigint): string {
  return format(milli, 3);
}

/** quantity (thousandths) x unit price (cents) -> cents, rounded half up. */
export function lineAmount(quantityMilli: bigint, unitCents: bigint): bigint {
  const product = quantityMilli * unitCents;
  const negative = product < 0n;
  const abs = negative ? -product : product;
  const rounded = (abs + 500n) / 1000n;
  return negative ? -rounded : rounded;
}
