/** M-Pesa confirmation codes are 10 capital letters/digits, e.g. QGH7XK2LMN. The server enforces this too. */
export function normalizeMpesaCode(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

export function mpesaCodeError(value: string): string | null {
  const code = normalizeMpesaCode(value);
  if (!code) return "Enter the M-Pesa transaction code from the confirmation message.";
  if (!/^[A-Z0-9]{10}$/.test(code)) return "The M-Pesa code is 10 letters/digits, e.g. QGH7XK2LMN.";
  return null;
}
