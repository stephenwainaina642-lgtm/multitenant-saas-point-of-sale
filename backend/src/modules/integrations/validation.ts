import { AppError } from "../../lib/errors.js";
import type { Environment, ProviderDefinition } from "./providers/index.js";

export type SaveInput = {
  environment?: Environment;
  config: Record<string, string>;
  secrets: Record<string, string>;
};

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Validates a settings update against the provider's own field list. Unknown fields are refused (so nothing
 * unexpected is ever stored), values must be text, and a blank secret means "keep what is saved".
 */
export function parseSaveBody(def: ProviderDefinition, body: unknown): SaveInput {
  if (!isPlainObject(body)) throw new AppError(400, "Send the settings as a JSON object");
  for (const k of Object.keys(body)) {
    if (!["environment", "config", "secrets"].includes(k)) throw new AppError(400, `Unknown field "${k}"`);
  }

  const out: SaveInput = { config: {}, secrets: {} };

  if (body.environment !== undefined) {
    if (body.environment !== "sandbox" && body.environment !== "production") {
      throw new AppError(400, "Environment must be sandbox or production");
    }
    out.environment = body.environment;
  }

  const cfg = body.config ?? {};
  const sec = body.secrets ?? {};
  if (!isPlainObject(cfg) || !isPlainObject(sec)) throw new AppError(400, "config and secrets must be objects");

  const byName = new Map(def.fields.map((f) => [f.name, f]));

  for (const [name, raw] of Object.entries(cfg)) {
    const f = byName.get(name);
    if (!f || f.kind !== "config") throw new AppError(400, `Unknown setting "${name}"`);
    if (typeof raw !== "string") throw new AppError(400, `${f.label} must be text`);
    const value = raw.trim();
    if (value === "" && f.required) throw new AppError(400, `${f.label} is required`);
    const problem = f.validate(value);
    if (problem) throw new AppError(400, problem);
    out.config[name] = value;
  }

  for (const [name, raw] of Object.entries(sec)) {
    const f = byName.get(name);
    if (!f || f.kind !== "secret") throw new AppError(400, `Unknown credential "${name}"`);
    if (raw === null || raw === undefined) continue;
    if (typeof raw !== "string") throw new AppError(400, `${f.label} must be text`);
    const value = raw.trim();
    if (value === "") continue; // blank = keep the saved one
    const problem = f.validate(value);
    if (problem) throw new AppError(400, problem);
    out.secrets[name] = value;
  }

  return out;
}

const IDEMPOTENCY = /^[A-Za-z0-9._:-]{8,100}$/;
export function parseIdempotencyKey(raw: unknown): string | null {
  if (raw === undefined || raw === "") return null;
  if (typeof raw !== "string" || !IDEMPOTENCY.test(raw)) throw new AppError(400, "Idempotency-Key must be 8-100 letters, digits or . _ : -");
  return raw;
}
