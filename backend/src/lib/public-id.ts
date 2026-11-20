import { AppError } from "./errors.js";

/**
 * Public identifiers are random UUIDs. They are the only identifiers the API shows or accepts for tables that
 * have been converted; the sequential database ids stay internal so nobody can count or guess records.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isPublicId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

/** Returns the lower-cased public id, or throws 400 with the given message. */
export function requirePublicId(v: unknown, message: string): string {
  if (!isPublicId(v)) throw new AppError(400, message);
  return v.toLowerCase();
}
