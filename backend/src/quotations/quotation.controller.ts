import type { NextFunction, Response } from "express";
import type { BusinessRequest } from "../auth/business.middleware.js";
import { AppError } from "../lib/errors.js";
import {
  convertQuotationToSale, createBusinessQuotation, getBusinessQuotationById, getBusinessQuotations,
  setQuotationStatus, updateBusinessQuotation,
} from "./quotation.service.js";

const biz = (req: BusinessRequest) => req.businessId!.toString();
const uid = (req: BusinessRequest) => (req.user ? String(req.user.userId) : undefined);

export async function getQuotationsController(req: BusinessRequest, res: Response, next: NextFunction) {
  try { res.json({ success: true, message: "Quotations retrieved successfully", data: await getBusinessQuotations(biz(req)) }); } catch (e) { next(e); }
}
export async function getQuotationByIdController(req: BusinessRequest, res: Response, next: NextFunction) {
  try { res.json({ success: true, message: "Quotation retrieved successfully", data: await getBusinessQuotationById(biz(req), String(req.params.id)) }); } catch (e) { next(e); }
}
export async function createQuotationController(req: BusinessRequest, res: Response, next: NextFunction) {
  try { res.status(201).json({ success: true, message: "Quotation created successfully", data: await createBusinessQuotation(biz(req), req.body ?? {}, uid(req)) }); } catch (e) { next(e); }
}
export async function updateQuotationController(req: BusinessRequest, res: Response, next: NextFunction) {
  try { res.json({ success: true, message: "Quotation updated successfully", data: await updateBusinessQuotation(biz(req), String(req.params.id), req.body ?? {}, uid(req)) }); } catch (e) { next(e); }
}
export async function quotationStatusController(req: BusinessRequest, res: Response, next: NextFunction) {
  try { res.json({ success: true, data: await setQuotationStatus(biz(req), String(req.params.id), req.body?.status, uid(req)) }); } catch (e) { next(e); }
}
export async function convertQuotationController(req: BusinessRequest, res: Response, next: NextFunction) {
  try {
    if (!req.permissions?.has("sales.create")) throw new AppError(403, "You need permission to create sales to convert a quotation");
    const data = await convertQuotationToSale(biz(req), String(req.params.id), req.body ?? {}, { userId: String(req.user!.userId) });
    res.status(201).json({ success: true, message: "Quotation converted to a sale", data });
  } catch (e) { next(e); }
}
