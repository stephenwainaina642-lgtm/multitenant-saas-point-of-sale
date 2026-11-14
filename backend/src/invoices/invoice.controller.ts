import type { NextFunction, Response } from "express";
import type { BusinessRequest } from "../auth/business.middleware.js";
import { createBusinessInvoice, getBusinessInvoiceById, getBusinessInvoices } from "./invoice.service.js";

const biz = (req: BusinessRequest) => req.businessId!.toString();

export async function getInvoicesController(req: BusinessRequest, res: Response, next: NextFunction) {
  try { res.json({ success: true, message: "Invoices retrieved successfully", data: await getBusinessInvoices(biz(req)) }); } catch (e) { next(e); }
}
export async function getInvoiceByIdController(req: BusinessRequest, res: Response, next: NextFunction) {
  try { res.json({ success: true, message: "Invoice retrieved successfully", data: await getBusinessInvoiceById(biz(req), String(req.params.id)) }); } catch (e) { next(e); }
}
export async function createInvoiceController(req: BusinessRequest, res: Response, next: NextFunction) {
  try {
    const data = await createBusinessInvoice(biz(req), req.body ?? {}, req.user ? String(req.user.userId) : undefined);
    res.status(201).json({ success: true, message: "Invoice created successfully", data });
  } catch (e) { next(e); }
}
