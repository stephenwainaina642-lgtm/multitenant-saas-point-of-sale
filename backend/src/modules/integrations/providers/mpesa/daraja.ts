import { providerBase, providerFetch } from "../http.js";
import type { Environment } from "../types.js";

export type DarajaCreds = {
  environment: Environment;
  consumerKey: string;
  consumerSecret: string;
  passkey: string;
  shortcode: string;
  /** Cache key: changes whenever the saved credentials change, so a stale token is never reused. */
  cacheId: string;
};

export class DarajaNetworkError extends Error {}
export class DarajaAuthError extends Error {}

const tokens = new Map<string, { token: string; expires: number }>();

async function accessToken(c: DarajaCreds): Promise<string> {
  const hit = tokens.get(c.cacheId);
  if (hit && hit.expires > Date.now() + 60_000) return hit.token;
  const basic = Buffer.from(`${c.consumerKey}:${c.consumerSecret}`).toString("base64");
  let r;
  try {
    r = await providerFetch(`${providerBase("mpesa", c.environment)}/oauth/v1/generate?grant_type=client_credentials`, {
      headers: { Authorization: `Basic ${basic}`, Accept: "application/json" },
    });
  } catch {
    throw new DarajaNetworkError("Could not reach Safaricom");
  }
  if (r.status !== 200 || typeof r.json?.access_token !== "string") throw new DarajaAuthError("Safaricom rejected the saved credentials");
  const seconds = Number(r.json.expires_in) || 3599;
  tokens.set(c.cacheId, { token: r.json.access_token, expires: Date.now() + seconds * 1000 });
  return r.json.access_token;
}

/** Daraja wants Nairobi time as YYYYMMDDHHmmss. */
export function darajaTimestamp(now = new Date()): string {
  return new Date(now.getTime() + 3 * 3600_000).toISOString().replace(/\D/g, "").slice(0, 14);
}
const password = (c: DarajaCreds, ts: string) => Buffer.from(`${c.shortcode}${c.passkey}${ts}`).toString("base64");

async function post(c: DarajaCreds, path: string, body: object) {
  const token = await accessToken(c);
  try {
    return await providerFetch(`${providerBase("mpesa", c.environment)}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new DarajaNetworkError("Could not reach Safaricom");
  }
}

export type StkPushInput = {
  amountKes: number; phone: string; partyB: string; transactionType: string;
  callbackUrl: string; accountReference: string; description: string;
};
export type StkPushOutcome =
  | { kind: "accepted"; checkoutRequestId: string; merchantRequestId: string }
  | { kind: "rejected"; message: string };

/** Asks Safaricom to show the payment prompt on the customer's phone. Accepted != paid. */
export async function stkPush(c: DarajaCreds, i: StkPushInput): Promise<StkPushOutcome> {
  const ts = darajaTimestamp();
  const r = await post(c, "/mpesa/stkpush/v1/processrequest", {
    BusinessShortCode: c.shortcode,
    Password: password(c, ts),
    Timestamp: ts,
    TransactionType: i.transactionType,
    Amount: i.amountKes,
    PartyA: i.phone,
    PartyB: i.partyB,
    PhoneNumber: i.phone,
    CallBackURL: i.callbackUrl,
    AccountReference: i.accountReference,
    TransactionDesc: i.description,
  });
  if (r.status === 200 && String(r.json?.ResponseCode) === "0" && typeof r.json?.CheckoutRequestID === "string") {
    return { kind: "accepted", checkoutRequestId: r.json.CheckoutRequestID, merchantRequestId: String(r.json.MerchantRequestID ?? "") };
  }
  if (r.status >= 500) throw new DarajaNetworkError("Safaricom is unavailable");
  const msg = String(r.json?.errorMessage ?? r.json?.ResponseDescription ?? r.json?.CustomerMessage ?? "Safaricom did not accept the request");
  return { kind: "rejected", message: msg.slice(0, 180) };
}

export type StkQueryOutcome =
  | { kind: "success" }
  | { kind: "failed"; resultCode: number; message: string }
  | { kind: "processing" };

/** Asks Safaricom directly what happened to a push. This, not a callback, is what proves payment. */
export async function stkQuery(c: DarajaCreds, checkoutRequestId: string): Promise<StkQueryOutcome> {
  const ts = darajaTimestamp();
  const r = await post(c, "/mpesa/stkpushquery/v1/query", {
    BusinessShortCode: c.shortcode, Password: password(c, ts), Timestamp: ts, CheckoutRequestID: checkoutRequestId,
  });
  if (r.status === 200 && String(r.json?.ResponseCode) === "0" && r.json?.ResultCode !== undefined) {
    const code = Number(r.json.ResultCode);
    if (code === 0) return { kind: "success" };
    return { kind: "failed", resultCode: code, message: String(r.json.ResultDesc ?? "Payment was not completed").slice(0, 180) };
  }
  // Daraja answers an unfinished push with an error ("being processed"), so anything else is "not decided yet".
  return { kind: "processing" };
}
