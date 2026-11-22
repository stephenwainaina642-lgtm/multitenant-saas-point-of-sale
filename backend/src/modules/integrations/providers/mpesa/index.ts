import type { FieldSpec, ProviderDefinition } from "../types.js";
import { networkMessage, providerBase, providerFetch } from "../http.js";

const digits = (min: number, max: number, what: string) => (v: string) =>
  new RegExp(`^\\d{${min},${max}}$`).test(v) ? null : `${what} must be ${min}-${max} digits`;
const secretText = (what: string, min = 6) => (v: string) =>
  v.length < min || v.length > 500 || /[\u0000-\u001f\s]/.test(v) ? `${what} looks invalid (no spaces, at least ${min} characters)` : null;

export const MPESA_FIELDS: FieldSpec[] = [
  { name: "consumerKey", label: "Consumer Key", kind: "secret", required: true, showHint: true, help: "From your app on the Safaricom Daraja portal." , validate: secretText("Consumer Key", 10) },
  { name: "consumerSecret", label: "Consumer Secret", kind: "secret", required: true, help: "From your app on the Safaricom Daraja portal.", validate: secretText("Consumer Secret", 10) },
  { name: "passkey", label: "Lipa Na M-PESA Passkey", kind: "secret", required: true, help: "The passkey for your shortcode (the sandbox portal shows a test one).", validate: secretText("Passkey", 20) },
  { name: "businessShortcode", label: "Business Shortcode", kind: "config", required: true, placeholder: "174379", help: "The Paybill or Till (store) number that receives the money.", validate: digits(5, 7, "Business Shortcode") },
  { name: "tillNumber", label: "Till / Paybill number shown to customers", kind: "config", required: false, placeholder: "Same as shortcode if blank", validate: (v) => (v === "" ? null : digits(5, 7, "Till / Paybill number")(v)) },
  {
    name: "transactionType", label: "Transaction type", kind: "config", required: true,
    options: [
      { value: "CustomerPayBillOnline", label: "Paybill (CustomerPayBillOnline)" },
      { value: "CustomerBuyGoodsOnline", label: "Till / Buy Goods (CustomerBuyGoodsOnline)" },
    ],
    validate: (v) => (v === "CustomerPayBillOnline" || v === "CustomerBuyGoodsOnline" ? null : "Choose Paybill or Till"),
  },
];

/**
 * Connection test = ask Safaricom for an access token with these credentials and throw the token away.
 * It proves the Consumer Key/Secret belong to the chosen environment. It does NOT prove the shortcode or
 * passkey (only a real STK Push does, which is a later milestone) and moves no money.
 */
export const mpesa: ProviderDefinition = {
  id: "mpesa",
  label: "M-PESA (Daraja)",
  tagline: "Safaricom STK Push: customers approve the payment on their phone.",
  available: true,
  fields: MPESA_FIELDS,
  async test({ environment, secrets }) {
    const basic = Buffer.from(`${secrets.consumerKey}:${secrets.consumerSecret}`).toString("base64");
    try {
      const r = await providerFetch(`${providerBase("mpesa", environment)}/oauth/v1/generate?grant_type=client_credentials`, {
        method: "GET",
        headers: { Authorization: `Basic ${basic}`, Accept: "application/json" },
      });
      if (r.status === 200 && typeof r.json?.access_token === "string") {
        return { ok: true, message: `Safaricom accepted the Consumer Key and Secret (${environment}). The shortcode and passkey are checked on the first real payment request.` };
      }
      if (r.status === 400 || r.status === 401 || r.status === 403) {
        return { ok: false, message: `Safaricom rejected these credentials for ${environment}. Check the Consumer Key and Secret belong to a ${environment} app.` };
      }
      return { ok: false, message: `Safaricom could not confirm the credentials right now (status ${r.status}). Try again shortly.` };
    } catch (e) {
      return { ok: false, message: networkMessage(e) };
    }
  },
};
