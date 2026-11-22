export type FieldInfo = {
  name: string; label: string; kind: "secret" | "config"; required: boolean;
  help: string | null; placeholder: string | null; options: { value: string; label: string }[] | null; showHint: boolean;
};
export type Status = "unavailable" | "not_configured" | "configured" | "verified" | "failed" | "enabled";
export type Integration = {
  provider: "mpesa" | "pesapal" | "etims";
  label: string; tagline: string; available: boolean; unavailableReason: string | null;
  fields: FieldInfo[]; environment: "sandbox" | "production"; isEnabled: boolean; status: Status; missing: string[];
  config: Record<string, string>;
  secrets: Record<string, { set: boolean; hint: string | null }>;
  lastTest: { status: "ok" | "failed"; at: string; message: string | null; current: boolean } | null;
  updatedAt: string | null;
};
export type IntegrationList = { encryptionReady: boolean; integrations: Integration[] };

export const session = () => ({
  token: sessionStorage.getItem("pos_token") ?? "",
  businessId: sessionStorage.getItem("pos_business_id") ?? "",
});
