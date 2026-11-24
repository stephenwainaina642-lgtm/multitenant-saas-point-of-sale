import type { NextFunction, Response } from "express";
import prisma from "../lib/prisma.js";
import { AppError } from "../lib/errors.js";
import type { BusinessRequest } from "../auth/business.middleware.js";

/**
 * Offline sales that arrived after the stock had run out. The sale is recorded and stock was taken down to zero; the
 * missing quantity is listed here so a manager can find out what really happened and correct stock with a normal adjustment.
 * Resolving only closes the item with a written reason: it never changes stock or any sale.
 */
export async function listShortfalls(req: BusinessRequest, res: Response, next: NextFunction) {
  try {
    const bizId = req.businessId!;
    const rows = await prisma.offlineStockShortfall.findMany({
      where: { businessId: bizId },
      orderBy: [{ resolvedAt: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }],
      take: 200,
      include: { sale: { select: { publicId: true, receiptNumber: true, offlineSoldAt: true } } },
    });
    const products = await prisma.product.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.productId))] } }, select: { id: true, name: true, sku: true, unitOfMeasure: true } });
    const by = new Map(products.map((p) => [p.id, p]));
    res.json({
      success: true,
      data: rows.map((r) => ({
        id: r.publicId, product: by.get(r.productId)?.name ?? "Unknown product", sku: by.get(r.productId)?.sku ?? null,
        unit: by.get(r.productId)?.unitOfMeasure ?? "", quantityShort: r.quantityShort.toString(),
        receiptNumber: r.sale.receiptNumber, saleId: r.sale.publicId, soldOfflineAt: r.sale.offlineSoldAt,
        recordedAt: r.createdAt, resolvedAt: r.resolvedAt, resolvedNote: r.resolvedNote,
      })),
    });
  } catch (e) { next(e); }
}

export async function resolveShortfall(req: BusinessRequest, res: Response, next: NextFunction) {
  try {
    const id = String(req.params.id);
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError(400, "Invalid id");
    const note = String(req.body?.note ?? "").replace(/[\u0000-\u001f]/g, " ").trim();
    if (note.length < 5 || note.length > 300) throw new AppError(400, "Write a reason of 5 to 300 characters (for example: recounted, adjusted stock)");
    const done = await prisma.offlineStockShortfall.updateMany({
      where: { publicId: id, businessId: req.businessId!, resolvedAt: null },
      data: { resolvedAt: new Date(), resolvedByUserId: BigInt(req.user!.userId), resolvedNote: note },
    });
    if (done.count !== 1) {
      const row = await prisma.offlineStockShortfall.findFirst({ where: { publicId: id, businessId: req.businessId! } });
      throw new AppError(row ? 409 : 404, row ? "Already resolved" : "Not found");
    }
    res.json({ success: true, data: { id } });
  } catch (e) { next(e); }
}
