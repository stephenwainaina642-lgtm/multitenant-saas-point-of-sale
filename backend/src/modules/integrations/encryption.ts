import crypto from "node:crypto";
import { AppError } from "../../lib/errors.js";

/**
 * AES-256-GCM for provider credentials.
 *  - The key lives ONLY in the deployment environment (INTEGRATIONS_ENCRYPTION_KEY), never in the database,
 *    and is not derived from JWT_SECRET, so rotating logins never makes credentials unreadable.
 *  - Every value gets a fresh random 96-bit IV and an authentication tag, so tampering is detected.
 *  - The business, provider and field name are bound in as additional authenticated data: a ciphertext
 *    copied to another tenant's row (or another field) fails to decrypt.
 *  - Key rotation: add INTEGRATIONS_ENCRYPTION_KEY_V2, set INTEGRATIONS_KEY_VERSION=2; old rows keep
 *    decrypting with the key version they were written with.
 */
const FORMAT = "v1";

function parseKey(raw: string | undefined): Buffer | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  const buf = /^[0-9a-fA-F]{64}$/.test(v) ? Buffer.from(v, "hex") : Buffer.from(v, "base64");
  return buf.length === 32 ? buf : null;
}

export function currentKeyVersion(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.INTEGRATIONS_KEY_VERSION ?? "1");
  return Number.isInteger(n) && n >= 1 && n <= 99 ? n : 1;
}

function keyFor(version: number, env: NodeJS.ProcessEnv = process.env): Buffer {
  const raw = version === 1 ? env.INTEGRATIONS_ENCRYPTION_KEY : env[`INTEGRATIONS_ENCRYPTION_KEY_V${version}`];
  const key = parseKey(raw);
  if (!key) {
    // The message is safe to show: it never names a value.
    throw new AppError(503, "Credential encryption is not set up on the server yet. Ask the platform administrator to set INTEGRATIONS_ENCRYPTION_KEY.");
  }
  return key;
}

/** True when saving credentials can work (used for the status screen, never exposes the key). */
export function encryptionReady(env: NodeJS.ProcessEnv = process.env): boolean {
  return parseKey(version1Or(env)) !== null;
}
const version1Or = (env: NodeJS.ProcessEnv) => {
  const v = currentKeyVersion(env);
  return v === 1 ? env.INTEGRATIONS_ENCRYPTION_KEY : env[`INTEGRATIONS_ENCRYPTION_KEY_V${v}`];
};

const aad = (businessId: bigint, provider: string, name: string) => Buffer.from(`${businessId}:${provider}:${name}`, "utf8");

export function encryptCredential(plain: string, ctx: { businessId: bigint; provider: string; name: string }): { ciphertext: string; keyVersion: number } {
  const keyVersion = currentKeyVersion();
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", keyFor(keyVersion), iv);
  c.setAAD(aad(ctx.businessId, ctx.provider, ctx.name));
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  const ciphertext = [FORMAT, iv, c.getAuthTag(), enc].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(".");
  return { ciphertext, keyVersion };
}

export function decryptCredential(stored: string, keyVersion: number, ctx: { businessId: bigint; provider: string; name: string }): string {
  const [fmt, iv, tag, enc] = stored.split(".");
  if (fmt !== FORMAT || !iv || !tag || !enc) throw new AppError(500, "A stored credential is unreadable. Re-enter it.");
  try {
    const d = crypto.createDecipheriv("aes-256-gcm", keyFor(keyVersion), Buffer.from(iv, "base64url"));
    d.setAAD(aad(ctx.businessId, ctx.provider, ctx.name));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(enc, "base64url")), d.final()]).toString("utf8");
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError(500, "A stored credential could not be verified. Re-enter it.");
  }
}
