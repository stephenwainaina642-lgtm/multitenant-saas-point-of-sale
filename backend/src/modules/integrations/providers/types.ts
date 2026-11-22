export type ProviderId = "mpesa" | "pesapal" | "etims";
export type Environment = "sandbox" | "production";

export type FieldSpec = {
  name: string;
  label: string;
  /** secret = encrypted and write-only; config = plain settings that are shown back. */
  kind: "secret" | "config";
  required: boolean;
  help?: string;
  placeholder?: string;
  /** For a config field with fixed choices. */
  options?: { value: string; label: string }[];
  /** Returns an error message, or null when the (already trimmed) value is acceptable. */
  validate: (value: string) => string | null;
  /** Secrets only: show the last 4 characters as a hint (safe for identifiers like a consumer key, never for secrets/passkeys). */
  showHint?: boolean;
};

export type TestResult = { ok: boolean; message: string };

export type ProviderDefinition = {
  id: ProviderId;
  label: string;
  tagline: string;
  /** False = the integration cannot be configured or enabled yet, with the honest reason. */
  available: boolean;
  unavailableReason?: string;
  fields: FieldSpec[];
  /** Config values the server fills in itself and the form must not send. */
  readOnlyConfig?: string[];
  test: (input: { environment: Environment; secrets: Record<string, string>; config: Record<string, string> }) => Promise<TestResult>;
};
