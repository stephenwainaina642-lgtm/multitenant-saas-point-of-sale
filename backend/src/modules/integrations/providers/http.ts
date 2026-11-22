/** Outbound calls to providers: fixed hosts only (never a user-supplied URL), short timeout, no redirects. */
const TIMEOUT_MS = 10_000;

/**
 * Providers' base URLs. NODE_ENV=test may point them at a local fake provider so tests never touch a real
 * account; the override is ignored in every other environment.
 */
export function providerBase(provider: "mpesa" | "pesapal", environment: "sandbox" | "production"): string {
  if (process.env.NODE_ENV === "test" && process.env.INTEGRATIONS_TEST_PROVIDER_BASE_URL) {
    return process.env.INTEGRATIONS_TEST_PROVIDER_BASE_URL.replace(/\/+$/, "");
  }
  if (provider === "mpesa") return environment === "production" ? "https://api.safaricom.co.ke" : "https://sandbox.safaricom.co.ke";
  return environment === "production" ? "https://pay.pesapal.com/v3" : "https://cybqa.pesapal.com/pesapalv3";
}

export async function providerFetch(url: string, init: RequestInit): Promise<{ status: number; json: any }> {
  const res = await fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS) });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* not JSON */
  }
  return { status: res.status, json };
}

/** Turns a network failure into a message that is useful to a business owner and leaks nothing. */
export function networkMessage(e: unknown): string {
  const name = (e as { name?: string })?.name;
  if (name === "TimeoutError" || name === "AbortError") return "The provider did not answer in time. Try again in a moment.";
  return "Could not reach the provider. Check your internet connection or try again shortly.";
}
