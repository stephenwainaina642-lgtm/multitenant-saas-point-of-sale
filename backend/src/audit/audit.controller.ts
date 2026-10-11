import type { Request, Response } from "express";
import { auditService } from "./audit.service.js";

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

    const userId =
      req.query.userId !== undefined
        ? BigInt(String(req.query.userId))
        : undefined;

    const action =
      req.query.action !== undefined
        ? String(req.query.action)
        : undefined;

    const entity =
      req.query.entity !== undefined
        ? String(req.query.entity)
        : undefined;

    const entityId =
      req.query.entityId !== undefined
        ? BigInt(String(req.query.entityId))
        : undefined;

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
      data: result.logs.map((log: any) => ({
        id: log.id.toString(),
        businessId: log.businessId.toString(),
        userId: log.userId?.toString() ?? null,
        action: log.action,
        entity: log.entity,
        entityId: log.entityId?.toString() ?? null,
        details: log.details,
        createdAt: log.createdAt,
        user: log.user
          ? {
              id: log.user.id.toString(),
              name: log.user.name,
              email: log.user.email,
            }
          : null,
      })),
      pagination: {
        total: result.total,
        limit,
        offset,
      },
    });
  } catch (error) {
    console.error("Get audit logs error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve audit logs",
    });
  }
}
