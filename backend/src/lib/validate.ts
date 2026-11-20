import { AppError } from "./errors.js";

/** Person names: letters (any language), spaces, apostrophe, hyphen and full stop. */
const PERSON_NAME = /^[\p{L}][\p{L}\p{M} '’.-]*$/u;
/** Business names (suppliers) may also hold digits and a few common symbols. */
const BUSINESS_NAME = /^[\p{L}\p{N}][\p{L}\p{M}\p{N} '’.&,()/-]*$/u;
const PHONE = /^\d{10}$/;

export function validPersonName(value: string): boolean {
  return PERSON_NAME.test(value);
}

/** Returns the trimmed name, or throws a 400 explaining the rule. */
export function personName(value: string, label = "Name"): string {
  const name = value.trim().replace(/\s+/g, " ");
  if (!PERSON_NAME.test(name)) {
    throw new AppError(400, `${label} may only contain letters, spaces, apostrophes, hyphens and full stops`);
  }
  return name;
}

export function businessName(value: string, label = "Name"): string {
  const name = value.trim().replace(/\s+/g, " ");
  if (!BUSINESS_NAME.test(name)) {
    throw new AppError(400, `${label} may only contain letters, numbers, spaces and . , ' & ( ) / -`);
  }
  return name;
}

/** Spaces and dashes are ignored; what remains must be exactly 10 digits. Empty means "no phone". */
export function phoneNumber(value: string, label = "Phone"): string | null {
  const raw = value.trim();
  if (!raw) return null;
  const digits = raw.replace(/[\s-]/g, "");
  if (!PHONE.test(digits)) throw new AppError(400, `${label} must be exactly 10 digits (for example 0712345678)`);
  return digits;
}
