import type { Request, Response } from "express";
import { auditService, auditEntityIdFromPublic, presentLogs } from "./audit.service.js";
import prisma from "../lib/prisma.js";
import { AppError } from "../lib/errors.js";
import { requirePublicId } from "../lib/public-id.js";

export async function getAuditLogsController(
  req: Request,
  res: Response
) {
  try {
    const rawBusinessId = (req as any).businessId;

    if (rawBusinessId === undefined || rawBusinessId === null) {
      return res.status(400).json({
        success: false,
        message: "Business ID is required",
      });
    }

    const businessId = BigInt(String(rawBusinessId));

    let userId: bigint | undefined;
    if (req.query.userId !== undefined) {
      const who = await prisma.user.findFirst({
        where: { publicId: requirePublicId(req.query.userId, "A valid user ID is required"), memberships: { some: { businessId } } },
        select: { id: true },
      });
      userId = who?.id ?? -1n; // not a person in this business: matches nothing
    }

    const action =
      req.query.action !== undefined
        ? String(req.query.action)
        : undefined;

    const entity =
      req.query.entity !== undefined
        ? String(req.query.entity)
        : undefined;

    let entityId: bigint | undefined;
    if (req.query.entityId !== undefined) {
      if (entity === undefined) throw new AppError(400, "entity is required when filtering by entityId");
      entityId = await auditEntityIdFromPublic(businessId, entity, requirePublicId(req.query.entityId, "A valid entity ID is required"));
    }

    const from =
      req.query.from !== undefined
        ? new Date(String(req.query.from))
        : undefined;

    const to =
      req.query.to !== undefined
        ? new Date(String(req.query.to))
        : undefined;

    const requestedLimit = Number(req.query.limit);

    const limit = Math.min(
      Math.max(
        Number.isFinite(requestedLimit) && requestedLimit > 0
          ? requestedLimit
          : 50,
        1
      ),
      200
    );

    const requestedOffset = Number(req.query.offset);

    const offset =
      Number.isFinite(requestedOffset) && requestedOffset >= 0
        ? requestedOffset
        : 0;

    const filters = {
      ...(userId !== undefined && { userId }),
      ...(action !== undefined && { action }),
      ...(entity !== undefined && { entity }),
      ...(entityId !== undefined && { entityId }),
      ...(from !== undefined && { from }),
      ...(to !== undefined && { to }),
      limit,
      offset,
    };

    const result = await auditService.getLogs(
      businessId,
      filters
    );

    return res.json({
      success: true,
      message: "Audit logs retrieved successfully",
      data: await presentLogs(businessId, result.logs as never),
      pagination: {
        total: result.total,
        limit,
        offset,
      },
    });
  } catch (error) {
    if (error instanceof AppError) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    console.error("Get audit logs error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve audit logs",
    });
  }
}
