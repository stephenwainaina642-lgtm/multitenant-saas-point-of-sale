import prisma from "../lib/prisma.js";

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
              id: true,
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
