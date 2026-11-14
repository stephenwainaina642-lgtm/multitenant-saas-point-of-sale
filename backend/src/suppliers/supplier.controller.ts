import type { NextFunction, Response } from "express";
import type { BusinessRequest } from "../auth/business.middleware.js";
import {
  createBusinessSupplier, deleteBusinessSupplier, getBusinessSuppliers, updateBusinessSupplier,
} from "./supplier.service.js";

const biz = (req: BusinessRequest) => req.businessId!.toString();

export async function getSuppliersController(req: BusinessRequest, res: Response, next: NextFunction) {
  try {
    res.json({ success: true, message: "Suppliers retrieved successfully", data: await getBusinessSuppliers(biz(req)) });
  } catch (e) { next(e); }
}

export async function createSupplierController(req: BusinessRequest, res: Response, next: NextFunction) {
  try {
    const data = await createBusinessSupplier(biz(req), req.body ?? {});
    res.status(201).json({ success: true, message: "Supplier created successfully", data });
  } catch (e) { next(e); }
}

export async function updateSupplierController(req: BusinessRequest, res: Response, next: NextFunction) {
  try {
    const data = await updateBusinessSupplier(biz(req), String(req.params.id), req.body ?? {});
    res.json({ success: true, message: "Supplier updated successfully", data });
  } catch (e) { next(e); }
}

export async function deleteSupplierController(req: BusinessRequest, res: Response, next: NextFunction) {
  try {
    const data = await deleteBusinessSupplier(biz(req), String(req.params.id));
    res.json({ success: true, message: "Supplier archived successfully", data });
  } catch (e) { next(e); }
}
