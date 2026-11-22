import type { ProviderDefinition, ProviderId } from "./types.js";
import { mpesa } from "./mpesa/index.js";
import { pesapal } from "./pesapal/index.js";
import { etims } from "./etims/index.js";

export const PROVIDERS: Record<ProviderId, ProviderDefinition> = { mpesa, pesapal, etims };
export const PROVIDER_ORDER: ProviderId[] = ["mpesa", "pesapal", "etims"];
export const isProviderId = (v: unknown): v is ProviderId => typeof v === "string" && Object.hasOwn(PROVIDERS, v);
export type { ProviderDefinition, ProviderId, FieldSpec, Environment } from "./types.js";
