import { AppError } from "./errors.js";
import type { Tx } from "../sales/sale-calc.js";

/**
 * M-Pesa confirmation codes are 10 characters, capital letters and digits (e.g. QGH7XK2LMN).
 * This only checks the SHAPE and that the code was not already used; it cannot tell whether the
 * money really arrived (that needs the Safaricom Daraja integration, which is not built).
 */
export function normalizeMpesaCode(raw: unknown): string {
  const code = typeof raw === "string" ? raw.trim().toUpperCase().replace(/\s+/g, "") : "";
  if (!code) throw new AppError(400, "Enter the M-Pesa transaction code for this payment");
  if (!/^[A-Z0-9]{10}$/.test(code)) {
    throw new AppError(400, "M-Pesa transaction code must be 10 letters/digits, e.g. QGH7XK2LMN");
  }
  return code;
}

/** Normalises a payment reference: M-Pesa needs a valid, unused code; other methods keep any short text. */
export async function checkedPaymentReference(
  tx: Tx,
  businessId: bigint,
  method: string,
  raw: unknown
): Promise<string | null> {
  if (method === "mpesa") {
    const code = normalizeMpesaCode(raw);
    const used = await tx.payment.findFirst({
      where: { businessId, method: "mpesa", reference: { equals: code, mode: "insensitive" } },
      select: { sale: { select: { receiptNumber: true } } },
    });
    if (used) throw new AppError(409, `This M-Pesa code was already used for sale ${used.sale.receiptNumber}`);
    return code;
  }
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string") throw new AppError(400, "Payment reference must be text");
  const text = raw.trim();
  if (text.length > 100) throw new AppError(400, "Payment reference must be at most 100 characters");
  return text || null;
}

/** Two requests with the same new code raced: the database index stopped the second one. */
export function isMpesaClash(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const e = error as { code?: string; message?: string; meta?: unknown };
  return e.code === "P2002" && `${e.message ?? ""}${JSON.stringify(e.meta ?? {})}`.includes("payments_mpesa_reference_unique");
}
export const MPESA_CLASH_MESSAGE = "This M-Pesa code was already used for another payment";
