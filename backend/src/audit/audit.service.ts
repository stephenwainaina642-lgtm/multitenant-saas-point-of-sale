import prisma from "../lib/prisma.js";

/** Which table an audit `entity` name points at (all hold a `publicId`). */
type Lookup = { findMany(args: { where: Record<string, unknown>; select: { id: true; publicId: true } }): Promise<{ id: bigint; publicId: string }[]> };
const ENTITY_TABLES: Record<string, { table: Lookup; scoped: boolean }> = {
  branch: { table: prisma.branch as unknown as Lookup, scoped: true },
  category: { table: prisma.category as unknown as Lookup, scoped: true },
  customer: { table: prisma.customer as unknown as Lookup, scoped: true },
  employee: { table: prisma.businessUser as unknown as Lookup, scoped: true },
  expense: { table: prisma.expense as unknown as Lookup, scoped: true },
  invoice: { table: prisma.invoice as unknown as Lookup, scoped: true },
  product: { table: prisma.product as unknown as Lookup, scoped: true },
  purchase: { table: prisma.purchase as unknown as Lookup, scoped: true },
  quotation: { table: prisma.quotation as unknown as Lookup, scoped: true },
  sale: { table: prisma.sale as unknown as Lookup, scoped: true },
  shift: { table: prisma.registerShift as unknown as Lookup, scoped: true },
  stock_transfer: { table: prisma.stockTransfer as unknown as Lookup, scoped: true },
  supplier: { table: prisma.supplier as unknown as Lookup, scoped: true },
  user: { table: prisma.user as unknown as Lookup, scoped: false },
};

/** The internal id behind an audit filter's public entity id, or -1n when it names nothing in this business. */
export async function auditEntityIdFromPublic(businessId: bigint, entity: string, publicId: string): Promise<bigint> {
  const spec = ENTITY_TABLES[entity];
  if (!spec) return -1n;
  const where = spec.scoped ? { publicId, businessId } : { publicId, memberships: { some: { businessId } } };
  const [row] = await spec.table.findMany({ where, select: { id: true, publicId: true } });
  return row?.id ?? -1n;
}

type LogRow = {
  id: bigint; publicId: string; businessId: bigint; userId: bigint | null; action: string; entity: string; entityId: bigint | null;
  details: unknown; createdAt: Date; user: { publicId: string; name: string; email: string } | null;
};

/** Shapes audit rows for the API. Stored history is untouched: numeric ids are swapped for public ids on the way out.
 *  An entity that has since been deleted can no longer be looked up, so its id shows as null. */
export async function presentLogs(businessId: bigint, logs: LogRow[]) {
  const business = await prisma.business.findUnique({ where: { id: businessId }, select: { publicId: true } });
  const byEntity = new Map<string, Set<bigint>>();
  const want = (entity: string, id: bigint | null) => { if (id !== null && ENTITY_TABLES[entity]) (byEntity.get(entity) ?? byEntity.set(entity, new Set()).get(entity)!).add(id); };
  const detailRef = (l: LogRow, key: "saleId" | "branchId") => {
    const v = (l.details as Record<string, unknown> | null)?.[key];
    return typeof v === "string" && /^[1-9]\d{0,17}$/.test(v) ? BigInt(v) : null;
  };
  for (const l of logs) {
    want(l.entity, l.entityId);
    want("sale", detailRef(l, "saleId"));
    want("branch", detailRef(l, "branchId"));
  }
  const names = new Map<string, Map<bigint, string>>();
  await Promise.all([...byEntity].map(async ([entity, ids]) => {
    const spec = ENTITY_TABLES[entity]!;
    const where = spec.scoped ? { id: { in: [...ids] }, businessId } : { id: { in: [...ids] }, memberships: { some: { businessId } } };
    const rows = await spec.table.findMany({ where, select: { id: true, publicId: true } });
    names.set(entity, new Map(rows.map((r) => [r.id, r.publicId])));
  }));
  const pub = (entity: string, id: bigint | null) => (id === null ? null : names.get(entity)?.get(id) ?? null);
  return logs.map((l) => {
    let details = l.details;
    if (details && typeof details === "object" && !Array.isArray(details)) {
      const d = { ...(details as Record<string, unknown>) };
      if ("saleId" in d) d.saleId = pub("sale", detailRef(l, "saleId"));
      if ("branchId" in d && d.branchId !== null) d.branchId = pub("branch", detailRef(l, "branchId"));
      details = d;
    }
    return {
      id: l.publicId,
      businessId: business?.publicId ?? null,
      userId: l.user?.publicId ?? null,
      action: l.action,
      entity: l.entity,
      entityId: pub(l.entity, l.entityId),
      details,
      createdAt: l.createdAt,
      user: l.user ? { id: l.user.publicId, name: l.user.name, email: l.user.email } : null,
    };
  });
}

export const auditService = {
  async createLog(
    businessId: bigint,
    data: {
      userId?: bigint;
      action: string;
      entity: string;
      entityId?: bigint;
      details?: unknown;
    }
  ) {
    return prisma.auditLog.create({
      data: {
        businessId,
        ...(data.userId !== undefined && { userId: data.userId }),
        action: data.action,
        entity: data.entity,
        ...(data.entityId !== undefined && { entityId: data.entityId }),
        ...(data.details !== undefined && {
          details: data.details as any,
        }),
      },
    });
  },

  async getLogs(
    businessId: bigint,
    filters: {
      userId?: bigint;
      action?: string;
      entity?: string;
      entityId?: bigint;
      from?: Date;
      to?: Date;
      limit?: number;
      offset?: number;
    } = {}
  ) {
    const where: any = {
      businessId,
    };

    if (filters.userId !== undefined) {
      where.userId = filters.userId;
    }

    if (filters.action !== undefined) {
      where.action = filters.action;
    }

    if (filters.entity !== undefined) {
      where.entity = filters.entity;
    }

    if (filters.entityId !== undefined) {
      where.entityId = filters.entityId;
    }

    if (filters.from !== undefined || filters.to !== undefined) {
      where.createdAt = {};

      if (filters.from !== undefined) {
        where.createdAt.gte = filters.from;
      }

      if (filters.to !== undefined) {
        where.createdAt.lte = filters.to;
      }
    }

    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: {
          user: {
            select: {
              publicId: true,
              name: true,
              email: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
        take: limit,
        skip: offset,
      }),

      prisma.auditLog.count({
        where,
      }),
    ]);

    return {
      logs,
      total,
    };
  },
};
