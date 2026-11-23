import { providerBase, providerFetch } from "../http.js";
import type { Environment } from "../types.js";

export type PesapalCreds = {
  environment: Environment;
  consumerKey: string;
  consumerSecret: string;
  /** Changes whenever the saved credentials change, so a stale token is never reused. */
  cacheId: string;
};

export class PesapalNetworkError extends Error {}
export class PesapalAuthError extends Error {}

const tokens = new Map<string, { token: string; expires: number }>();
const TOKEN_LIFE_MS = 4 * 60_000; // Pesapal tokens last about 5 minutes; refresh early.

async function accessToken(c: PesapalCreds): Promise<string> {
  const hit = tokens.get(c.cacheId);
  if (hit && hit.expires > Date.now()) return hit.token;
  let r;
  try {
    r = await providerFetch(`${providerBase("pesapal", c.environment)}/api/Auth/RequestToken`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ consumer_key: c.consumerKey, consumer_secret: c.consumerSecret }),
    });
  } catch {
    throw new PesapalNetworkError("Could not reach Pesapal");
  }
  if (r.status >= 500) throw new PesapalNetworkError("Pesapal is unavailable");
  if (r.status !== 200 || typeof r.json?.token !== "string" || !r.json.token || r.json.error) throw new PesapalAuthError("Pesapal rejected the saved credentials");
  tokens.set(c.cacheId, { token: r.json.token, expires: Date.now() + TOKEN_LIFE_MS });
  return r.json.token;
}

async function call(c: PesapalCreds, method: "GET" | "POST", path: string, body?: object) {
  const token = await accessToken(c);
  try {
    return await providerFetch(`${providerBase("pesapal", c.environment)}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
      ...(body && { body: JSON.stringify(body) }),
    });
  } catch {
    throw new PesapalNetworkError("Could not reach Pesapal");
  }
}

/** Registers the address Pesapal will notify. Returns Pesapal's ipn_id. */
export async function registerIpn(c: PesapalCreds, url: string): Promise<{ ok: true; ipnId: string } | { ok: false; message: string }> {
  const r = await call(c, "POST", "/api/URLSetup/RegisterIPN", { url, ipn_notification_type: "GET" });
  if (r.status >= 500) throw new PesapalNetworkError("Pesapal is unavailable");
  if (r.status === 200 && typeof r.json?.ipn_id === "string" && r.json.ipn_id && !r.json.error) return { ok: true, ipnId: r.json.ipn_id };
  const msg = String(r.json?.error?.message ?? r.json?.message ?? "Pesapal did not accept the notification address").slice(0, 180);
  return { ok: false, message: msg };
}

export type SubmitOrderInput = {
  merchantReference: string; amountKes: string; description: string; callbackUrl: string; ipnId: string;
  phone: string | null; email: string | null; merchantName: string;
};
export type SubmitOrderOutcome =
  | { kind: "created"; orderTrackingId: string; redirectUrl: string }
  | { kind: "rejected"; message: string };

/** Creates the hosted checkout order. Created != paid: the customer has only been given a page to pay on. */
export async function submitOrder(c: PesapalCreds, i: SubmitOrderInput): Promise<SubmitOrderOutcome> {
  const r = await call(c, "POST", "/api/Transactions/SubmitOrderRequest", {
    id: i.merchantReference,
    currency: "KES",
    amount: Number(i.amountKes),
    description: i.description,
    callback_url: i.callbackUrl,
    notification_id: i.ipnId,
    billing_address: {
      ...(i.email && { email_address: i.email }),
      ...(i.phone && { phone_number: i.phone }),
      country_code: "KE",
      first_name: i.merchantName.slice(0, 40),
    },
  });
  if (r.status >= 500) throw new PesapalNetworkError("Pesapal is unavailable");
  if (r.status === 200 && typeof r.json?.order_tracking_id === "string" && typeof r.json?.redirect_url === "string" && !r.json.error) {
    if (!/^https:\/\//.test(r.json.redirect_url)) return { kind: "rejected", message: "Pesapal returned an unexpected payment page address" };
    return { kind: "created", orderTrackingId: r.json.order_tracking_id, redirectUrl: r.json.redirect_url };
  }
  const msg = String(r.json?.error?.message ?? r.json?.message ?? "Pesapal did not accept the order").slice(0, 180);
  return { kind: "rejected", message: msg };
}

export type TransactionOutcome =
  | { kind: "completed"; amount: number; currency: string; merchantReference: string; confirmationCode: string | null; payMethod: string | null }
  | { kind: "failed"; message: string }
  | { kind: "reversed"; message: string }
  | { kind: "processing" };

/** Asks Pesapal directly what happened to an order. This, not an IPN or a redirect, is what proves payment. */
export async function getTransactionStatus(c: PesapalCreds, orderTrackingId: string): Promise<TransactionOutcome> {
  const r = await call(c, "GET", `/api/Transactions/GetTransactionStatus?orderTrackingId=${encodeURIComponent(orderTrackingId)}`);
  if (r.status >= 500) throw new PesapalNetworkError("Pesapal is unavailable");
  if (r.status !== 200 || !r.json || r.json.error) return { kind: "processing" };
  const code = Number(r.json.status_code);
  const desc = String(r.json.payment_status_description ?? r.json.message ?? "").slice(0, 180);
  if (code === 1) {
    return {
      kind: "completed",
      amount: Number(r.json.amount),
      currency: String(r.json.currency ?? ""),
      merchantReference: String(r.json.merchant_reference ?? ""),
      confirmationCode: typeof r.json.confirmation_code === "string" && /^[A-Za-z0-9._-]{3,60}$/.test(r.json.confirmation_code) ? r.json.confirmation_code : null,
      payMethod: typeof r.json.payment_method === "string" ? r.json.payment_method.slice(0, 60) : null,
    };
  }
  if (code === 2) return { kind: "failed", message: desc || "Payment failed" };
  if (code === 3) return { kind: "reversed", message: desc || "Payment was reversed" };
  return { kind: "processing" }; // 0 = INVALID / not found yet, or anything unknown: never guess
}
