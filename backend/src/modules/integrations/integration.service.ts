import { Prisma } from "../../generated/prisma/client.js";
import prisma from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { decryptCredential, encryptCredential, encryptionReady } from "./encryption.js";
import { recordIntegrationAudit, type IntegrationActor } from "./audit.js";
import { PROVIDERS, PROVIDER_ORDER, type FieldSpec, type ProviderDefinition, type ProviderId } from "./providers/index.js";
import { parseSaveBody } from "./validation.js";

type Conn = Prisma.IntegrationConnectionGetPayload<{ include: { secrets: { select: { name: true; hint: true } } } }>;

export type IntegrationStatus = "unavailable" | "not_configured" | "configured" | "verified" | "failed" | "enabled";

const publicField = (f: FieldSpec) => ({
  name: f.name, label: f.label, kind: f.kind, required: f.required,
  help: f.help ?? null, placeholder: f.placeholder ?? null, options: f.options ?? null, showHint: f.showHint ?? false,
});

const cfgOf = (c: Conn | null): Record<string, string> =>
  c && c.config && typeof c.config === "object" && !Array.isArray(c.config) ? (c.config as Record<string, string>) : {};

function missingRequired(def: ProviderDefinition, c: Conn | null): string[] {
  const cfg = cfgOf(c);
  const have = new Set(c?.secrets.map((s) => s.name) ?? []);
  return def.fields
    .filter((f) => f.required && (f.kind === "secret" ? !have.has(f.name) : !cfg[f.name]))
    .map((f) => f.label);
}

const verified = (c: Conn | null) => !!c && c.lastTestStatus === "ok" && c.lastTestVersion === c.settingsVersion;

function statusOf(def: ProviderDefinition, c: Conn | null): IntegrationStatus {
  if (!def.available) return "unavailable";
  if (c?.isEnabled) return "enabled";
  if (!c || missingRequired(def, c).length > 0) return "not_configured";
  if (verified(c)) return "verified";
  if (c.lastTestStatus === "failed" && c.lastTestVersion === c.settingsVersion) return "failed";
  return "configured";
}

/** What the API may say about a connection. Never includes a secret value, ciphertext or the key. */
function present(def: ProviderDefinition, c: Conn | null) {
  const cfg = cfgOf(c);
  const shown: Record<string, string> = {};
  for (const f of def.fields) if (f.kind === "config") shown[f.name] = cfg[f.name] ?? "";
  for (const k of def.readOnlyConfig ?? []) shown[k] = cfg[k] ?? "not_registered";
  const secrets: Record<string, { set: boolean; hint: string | null }> = {};
  for (const f of def.fields) {
    if (f.kind !== "secret") continue;
    const row = c?.secrets.find((s) => s.name === f.name);
    secrets[f.name] = { set: !!row, hint: row?.hint ?? null };
  }
  return {
    provider: def.id,
    label: def.label,
    tagline: def.tagline,
    available: def.available,
    unavailableReason: def.unavailableReason ?? null,
    fields: def.fields.map(publicField),
    environment: c?.environment ?? "sandbox",
    isEnabled: c?.isEnabled ?? false,
    status: statusOf(def, c),
    missing: def.available ? missingRequired(def, c) : [],
    config: shown,
    secrets,
    lastTest: c?.lastTestStatus
      ? { status: c.lastTestStatus, at: c.lastTestAt, message: c.lastTestMessage, current: c.lastTestVersion === c.settingsVersion }
      : null,
    updatedAt: c?.updatedAt ?? null,
  };
}

const include = { secrets: { select: { name: true, hint: true } } } as const;
const load = (businessId: bigint, provider: ProviderId) =>
  prisma.integrationConnection.findUnique({ where: { businessId_provider: { businessId, provider } }, include });

function definition(provider: ProviderId): ProviderDefinition {
  return PROVIDERS[provider];
}
function requireAvailable(def: ProviderDefinition) {
  if (!def.available) throw new AppError(409, def.unavailableReason ?? "This integration is not available yet");
}

export async function listIntegrations(businessId: bigint) {
  const rows = await prisma.integrationConnection.findMany({ where: { businessId }, include });
  const by = new Map(rows.map((r) => [r.provider, r]));
  return {
    encryptionReady: encryptionReady(),
    integrations: PROVIDER_ORDER.map((p) => present(PROVIDERS[p], by.get(p) ?? null)),
  };
}

export async function getIntegration(businessId: bigint, provider: ProviderId) {
  return present(definition(provider), await load(businessId, provider));
}

export async function saveIntegration(actor: IntegrationActor, provider: ProviderId, body: unknown) {
  const def = definition(provider);
  requireAvailable(def);
  const input = parseSaveBody(def, body);
  const secretNames = Object.keys(input.secrets);

  // Encrypt first: if the server key is missing we fail before anything is written.
  const encrypted = secretNames.map((name) => {
    const f = def.fields.find((x) => x.name === name)!;
    const { ciphertext, keyVersion } = encryptCredential(input.secrets[name]!, { businessId: actor.businessId, provider, name });
    return { name, ciphertext, keyVersion, hint: f.showHint ? input.secrets[name]!.slice(-4) : null };
  });

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.integrationConnection.findUnique({
      where: { businessId_provider: { businessId: actor.businessId, provider } }, include,
    });
    const oldCfg = cfgOf(existing);
    const changedConfig = Object.keys(input.config).filter((k) => (oldCfg[k] ?? "") !== input.config[k]);
    const envChanged = input.environment !== undefined && input.environment !== (existing?.environment ?? "sandbox");
    const credentialsChanged = encrypted.length > 0;

    if (existing && changedConfig.length === 0 && !envChanged && !credentialsChanged) return { conn: existing, changed: false, autoDisabled: false, changedConfig, envChanged, secretNames };

    const bump = envChanged || credentialsChanged;
    const autoDisabled = bump && !!existing?.isEnabled;
    const mergedConfig = { ...oldCfg, ...input.config };

    let conn = existing;
    if (!conn) {
      const created = await tx.integrationConnection.create({
        data: {
          businessId: actor.businessId, provider, environment: input.environment ?? "sandbox",
          config: mergedConfig, createdByUserId: actor.userId, updatedByUserId: actor.userId,
        },
        include,
      });
      conn = created;
    } else {
      conn = await tx.integrationConnection.update({
        where: { id: conn.id },
        data: {
          ...(input.environment !== undefined && { environment: input.environment }),
          config: mergedConfig,
          updatedByUserId: actor.userId,
          updatedAt: new Date(),
          ...(bump && { settingsVersion: { increment: 1 } }),
          ...(autoDisabled && { isEnabled: false }),
        },
        include,
      });
    }
    // A brand-new row with credentials also needs a fresh "unverified" state (it has no test yet).
    for (const e of encrypted) {
      await tx.integrationSecret.upsert({
        where: { connectionId_name: { connectionId: conn.id, name: e.name } },
        create: { businessId: actor.businessId, connectionId: conn.id, name: e.name, ciphertext: e.ciphertext, keyVersion: e.keyVersion, hint: e.hint },
        update: { ciphertext: e.ciphertext, keyVersion: e.keyVersion, hint: e.hint, updatedAt: new Date() },
      });
    }
    const fresh = await tx.integrationConnection.findUniqueOrThrow({ where: { id: conn.id }, include });
    return { conn: fresh, changed: true, autoDisabled, changedConfig, envChanged, secretNames };
  });

  if (result.changed) {
    await recordIntegrationAudit(actor, provider, result.conn.id, existingAction(result), {
      configFieldsChanged: result.changedConfig,
      credentialsReplaced: result.secretNames,
      environmentChanged: result.envChanged,
    });
    if (result.autoDisabled) {
      await recordIntegrationAudit(actor, provider, result.conn.id, "auto_disabled", { reason: "credentials or environment changed; test the connection again" });
    }
  }
  return present(def, result.conn);
}
const existingAction = (r: { changedConfig: string[]; secretNames: string[]; envChanged: boolean }) =>
  r.secretNames.length ? "credentials_updated" : r.envChanged ? "environment_changed" : "settings_updated";

export async function testIntegration(actor: IntegrationActor, provider: ProviderId, idempotencyKey: string | null) {
  const def = definition(provider);
  requireAvailable(def);
  const conn = await load(actor.businessId, provider);
  if (!conn) throw new AppError(400, "Save the credentials first, then test the connection");
  const missing = missingRequired(def, conn);
  if (missing.length) throw new AppError(400, `Fill in: ${missing.join(", ")}`);

  if (idempotencyKey) {
    const prior = await prisma.integrationEvent.findUnique({
      where: { businessId_connectionId_idempotencyKey: { businessId: actor.businessId, connectionId: conn.id, idempotencyKey } },
    });
    if (prior) {
      const p = prior.payload as { message?: string };
      return { ok: prior.status === "ok", message: p.message ?? "", replayed: true, integration: present(def, conn) };
    }
  }

  const rows = await prisma.integrationSecret.findMany({ where: { connectionId: conn.id } });
  const secrets: Record<string, string> = {};
  for (const r of rows) {
    secrets[r.name] = decryptCredential(r.ciphertext, r.keyVersion, { businessId: actor.businessId, provider, name: r.name });
  }

  const version = conn.settingsVersion;
  const outcome = await def.test({ environment: conn.environment as "sandbox" | "production", secrets, config: cfgOf(conn) });
  const status = outcome.ok ? "ok" : "failed";

  try {
    await prisma.integrationEvent.create({
      data: {
        businessId: actor.businessId, connectionId: conn.id, type: "connection_test", status,
        idempotencyKey, payload: { message: outcome.message, environment: conn.environment, settingsVersion: version },
      },
    });
  } catch (e) {
    // Two identical requests raced: the other one recorded it, so report its result instead of failing.
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
  }
  // Only record the result if the settings were not changed while the test was running.
  await prisma.integrationConnection.updateMany({
    where: { id: conn.id, settingsVersion: version },
    data: { lastTestStatus: status, lastTestAt: new Date(), lastTestMessage: outcome.message.slice(0, 300), lastTestVersion: version },
  });
  await recordIntegrationAudit(actor, provider, conn.id, outcome.ok ? "test_passed" : "test_failed", { environment: conn.environment });
  return { ok: outcome.ok, message: outcome.message, replayed: false, integration: present(def, await load(actor.businessId, provider)) };
}

export async function setIntegrationEnabled(actor: IntegrationActor, provider: ProviderId, enabled: boolean, confirm: unknown) {
  const def = definition(provider);
  requireAvailable(def);
  const conn = await load(actor.businessId, provider);
  if (!conn) throw new AppError(400, "Set up and test this integration first");
  if (enabled === conn.isEnabled) return present(def, conn); // idempotent

  if (enabled) {
    const missing = missingRequired(def, conn);
    if (missing.length) throw new AppError(400, `Fill in: ${missing.join(", ")}`);
    if (!verified(conn)) throw new AppError(409, "Test the connection successfully (with the current credentials) before enabling");
  } else if (confirm !== true) {
    throw new AppError(400, "Confirm that you want to disable this integration");
  }

  await prisma.integrationConnection.update({
    where: { id: conn.id },
    data: { isEnabled: enabled, updatedByUserId: actor.userId, updatedAt: new Date() },
  });
  await recordIntegrationAudit(actor, provider, conn.id, enabled ? "enabled" : "disabled", { environment: conn.environment });
  return present(def, await load(actor.businessId, provider));
}
