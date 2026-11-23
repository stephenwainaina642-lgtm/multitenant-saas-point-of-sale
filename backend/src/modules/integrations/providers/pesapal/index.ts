import type { FieldSpec, ProviderDefinition } from "../types.js";
import { networkMessage, providerBase, providerFetch } from "../http.js";

const secretText = (what: string, min = 8) => (v: string) =>
  v.length < min || v.length > 500 || /[\u0000-\u001f\s]/.test(v) ? `${what} looks invalid (no spaces, at least ${min} characters)` : null;

export const PESAPAL_FIELDS: FieldSpec[] = [
  { name: "consumerKey", label: "Consumer Key", kind: "secret", required: true, showHint: true, help: "From your Pesapal merchant account (API 3.0).", validate: secretText("Consumer Key") },
  { name: "consumerSecret", label: "Consumer Secret", kind: "secret", required: true, help: "From your Pesapal merchant account (API 3.0).", validate: secretText("Consumer Secret") },
  { name: "merchantName", label: "Merchant name", kind: "config", required: true, placeholder: "Name on your Pesapal account", validate: (v) => (v.length >= 2 && v.length <= 100 ? null : "Merchant name must be 2-100 characters") },
  { name: "notificationEmail", label: "Notification email", kind: "config", required: false, placeholder: "payments@yourshop.co.ke", help: "Where Pesapal-related notices for this business should go.", validate: (v) => (v === "" || (v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) ? null : "Enter a valid email address") },
];

/**
 * Connection test = request an API 3.0 access token and discard it. Pesapal can answer HTTP 200 with an error
 * object for bad credentials, so success means a token is present AND no error is reported.
 * IPN registration is a separate step (POST /integrations/pesapal/register-ipn).
 */
export const pesapal: ProviderDefinition = {
  id: "pesapal",
  label: "Pesapal (API 3.0)",
  tagline: "Cards, M-PESA and bank payments through Pesapal's hosted checkout.",
  available: true,
  fields: PESAPAL_FIELDS,
  readOnlyConfig: ["ipnStatus"],
  async test({ environment, secrets }) {
    try {
      const r = await providerFetch(`${providerBase("pesapal", environment)}/api/Auth/RequestToken`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ consumer_key: secrets.consumerKey, consumer_secret: secrets.consumerSecret }),
      });
      if (r.status === 200 && typeof r.json?.token === "string" && r.json.token && !r.json.error) {
        return { ok: true, message: `Pesapal accepted the Consumer Key and Secret (${environment}). Next, register the notification address.` };
      }
      if (r.json?.error || r.status === 400 || r.status === 401 || r.status === 403) {
        return { ok: false, message: `Pesapal rejected these credentials for ${environment}. Check they belong to a ${environment} account.` };
      }
      return { ok: false, message: `Pesapal could not confirm the credentials right now (status ${r.status}). Try again shortly.` };
    } catch (e) {
      return { ok: false, message: networkMessage(e) };
    }
  },
};
