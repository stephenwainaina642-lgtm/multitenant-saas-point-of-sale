import prisma from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { decryptCredential } from "./encryption.js";
import type { DarajaCreds } from "./providers/mpesa/daraja.js";

/** Decrypts a business's saved M-PESA credentials for server-side use. They are never sent anywhere but Safaricom. */
export async function loadMpesa(businessId: bigint, requireEnabled: boolean) {
  const conn = await prisma.integrationConnection.findUnique({ where: { businessId_provider: { businessId, provider: "mpesa" } } });
  if (!conn) throw new AppError(409, "M-PESA is not set up for this business");
  if (requireEnabled && !conn.isEnabled) throw new AppError(409, "M-PESA is not enabled. Test and enable it in Settings first");
  const rows = await prisma.integrationSecret.findMany({ where: { connectionId: conn.id } });
  const s: Record<string, string> = {};
  for (const r of rows) s[r.name] = decryptCredential(r.ciphertext, r.keyVersion, { businessId, provider: "mpesa", name: r.name });
  const cfg = (conn.config ?? {}) as Record<string, string>;
  if (!s.consumerKey || !s.consumerSecret || !s.passkey || !cfg.businessShortcode || !cfg.transactionType) {
    throw new AppError(409, "M-PESA settings are incomplete");
  }
  const creds: DarajaCreds = {
    environment: conn.environment as "sandbox" | "production",
    consumerKey: s.consumerKey, consumerSecret: s.consumerSecret, passkey: s.passkey,
    shortcode: cfg.businessShortcode, cacheId: `${conn.id}:${conn.settingsVersion}`,
  };
  return { conn, creds, transactionType: cfg.transactionType, partyB: cfg.tillNumber || cfg.businessShortcode };
}

import type { PesapalCreds } from "./providers/pesapal/client.js";

/** Decrypts a business's saved Pesapal credentials for server-side use. They are only ever sent to Pesapal. */
export async function loadPesapal(businessId: bigint, requireEnabled: boolean) {
  const conn = await prisma.integrationConnection.findUnique({ where: { businessId_provider: { businessId, provider: "pesapal" } } });
  if (!conn) throw new AppError(409, "Pesapal is not set up for this business");
  if (requireEnabled && !conn.isEnabled) throw new AppError(409, "Pesapal is not enabled. Test and enable it in Settings first");
  const rows = await prisma.integrationSecret.findMany({ where: { connectionId: conn.id } });
  const s: Record<string, string> = {};
  for (const r of rows) s[r.name] = decryptCredential(r.ciphertext, r.keyVersion, { businessId, provider: "pesapal", name: r.name });
  const cfg = (conn.config ?? {}) as Record<string, string>;
  if (!s.consumerKey || !s.consumerSecret || !cfg.merchantName) throw new AppError(409, "Pesapal settings are incomplete");
  const creds: PesapalCreds = {
    environment: conn.environment as "sandbox" | "production",
    consumerKey: s.consumerKey, consumerSecret: s.consumerSecret, cacheId: `${conn.id}:${conn.settingsVersion}`,
  };
  return { conn, creds, cfg };
}
