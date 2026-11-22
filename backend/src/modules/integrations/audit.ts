import prisma from "../../lib/prisma.js";
import { auditService } from "../../audit/audit.service.js";
import type { ProviderId } from "./providers/index.js";

export type IntegrationActor = { businessId: bigint; userId: bigint; ip?: string | undefined };

/**
 * Records who did what to an integration. `details` may list which FIELDS changed, never their values:
 * nothing secret (or even configuration text) is written to either log.
 */
export async function recordIntegrationAudit(
  actor: IntegrationActor,
  provider: ProviderId,
  connectionId: bigint | null,
  action: string,
  details: Record<string, unknown> = {}
): Promise<void> {
  await prisma.integrationAuditLog.create({
    data: {
      businessId: actor.businessId,
      connectionId,
      provider,
      userId: actor.userId,
      action,
      details: details as object,
      ip: actor.ip ? actor.ip.slice(0, 64) : null,
    },
  });
  // Also show it in the business-wide audit trail.
  await auditService.createLog(actor.businessId, {
    userId: actor.userId,
    action: `integration.${action}`,
    entity: "integration",
    details: { provider, ...details },
  });
}
