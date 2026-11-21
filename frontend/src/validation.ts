// Input rules shared by every form. The server enforces the same rules; these give instant feedback.
const NAME_ALLOWED = /^[\p{L}][\p{L}\p{M} '’.-]*$/u;
const BUSINESS_ALLOWED = /^[\p{L}\p{N}][\p{L}\p{M}\p{N} '’.&,()/-]*$/u;

/** Live filter for a person-name field: drops characters that are never allowed. */
export const cleanName = (v: string) => v.replace(/[^\p{L}\p{M} '’.-]/gu, "");
export const cleanBusinessName = (v: string) => v.replace(/[^\p{L}\p{M}\p{N} '’.&,()/-]/gu, "");
/** Live filter for a phone field: digits only, at most 10. */
export const cleanPhone = (v: string) => v.replace(/\D/g, "").slice(0, 10);

/** Returns an error message, or null when the name is fine. */
export function checkName(v: string, label = "Name"): string | null {
  const t = v.trim();
  if (!t) return `Enter the ${label.toLowerCase()}.`;
  return NAME_ALLOWED.test(t) ? null : `${label} may only contain letters, spaces, apostrophes, hyphens and full stops.`;
}
export function checkBusinessName(v: string, label = "Name"): string | null {
  const t = v.trim();
  if (!t) return `Enter the ${label.toLowerCase()}.`;
  return BUSINESS_ALLOWED.test(t) ? null : `${label} may only contain letters, numbers, spaces and . , ' & ( ) / -`;
}
/** Phone is optional unless `required`; when given it must be exactly 10 digits. */
export function checkPhone(v: string, required = false): string | null {
  const d = v.replace(/[\s-]/g, "");
  if (!d) return required ? "Enter a 10-digit phone number." : null;
  return /^\d{10}$/.test(d) ? null : "Phone number must be exactly 10 digits (for example 0712345678).";
}
export const PHONE_PROPS = { inputMode: "numeric" as const, maxLength: 10, placeholder: "0712345678", autoComplete: "tel" };
