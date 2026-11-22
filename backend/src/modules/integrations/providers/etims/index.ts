import type { ProviderDefinition } from "../types.js";

/**
 * KRA eTIMS (OSCU). The credential fields, endpoints and device-initialisation steps are defined by KRA's
 * approved specification and onboarding. None of that has been supplied, and nothing here is guessed, so
 * this provider is listed but cannot be configured, tested or enabled. It never claims compliance.
 */
export const etims: ProviderDefinition = {
  id: "etims",
  label: "KRA eTIMS (OSCU)",
  tagline: "Electronic tax invoicing with the Kenya Revenue Authority.",
  available: false,
  unavailableReason:
    "Not available yet. eTIMS OSCU needs KRA's approved technical specification and your business's KRA onboarding. Until then nexaPOS does not submit anything to KRA and receipts are not eTIMS-compliant.",
  fields: [],
  async test() {
    return { ok: false, message: "eTIMS cannot be tested yet: it is waiting for KRA's approved specification." };
  },
};
