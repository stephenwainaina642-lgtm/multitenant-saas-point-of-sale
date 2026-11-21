// One place decides how money looks, so every screen, receipt and report agrees.
// Amounts are stored and calculated to the cent; this only changes what is shown:
// whole shillings show without ".00"; an amount that really has cents keeps them, so a receipt never states a
// total that differs from what is owed.
const whole = new Intl.NumberFormat("en-KE", { maximumFractionDigits: 0 });
const withCents = new Intl.NumberFormat("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 1500 -> "1,500"; 1499.5 -> "1,499.50". */
export function amount(value: number | string | null | undefined): string {
  const cents = Math.round((Number(value) || 0) * 100);
  return cents % 100 === 0 ? whole.format(cents / 100) : withCents.format(cents / 100);
}

/** 1500 -> "KSh 1,500". */
export const money = (value: number | string | null | undefined): string => `KSh ${amount(value)}`;

/** For input boxes: 1500 -> "1500", 1499.5 -> "1499.50" (no thousands separator). */
export function plainAmount(value: number): string {
  const cents = Math.round((Number(value) || 0) * 100);
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}
