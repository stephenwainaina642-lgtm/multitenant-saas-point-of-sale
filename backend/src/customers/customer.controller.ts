import type { NextFunction, Response } from "express";
import type { BusinessRequest } from "../auth/business.middleware.js";
import {
  createBusinessCustomer, deleteBusinessCustomer, getBusinessCustomers, updateBusinessCustomer,
} from "./customer.service.js";

const biz = (req: BusinessRequest) => req.businessId!.toString();

export async function getCustomersController(req: BusinessRequest, res: Response, next: NextFunction) {
  try {
    res.json({ success: true, message: "Customers retrieved successfully", data: await getBusinessCustomers(biz(req)) });
  } catch (e) { next(e); }
}

export async function createCustomerController(req: BusinessRequest, res: Response, next: NextFunction) {
  try {
    const data = await createBusinessCustomer(biz(req), req.body ?? {});
    res.status(201).json({ success: true, message: "Customer created successfully", data });
  } catch (e) { next(e); }
}

export async function updateCustomerController(req: BusinessRequest, res: Response, next: NextFunction) {
  try {
    const data = await updateBusinessCustomer(biz(req), String(req.params.id), req.body ?? {});
    res.json({ success: true, message: "Customer updated successfully", data });
  } catch (e) { next(e); }
}

export async function deleteCustomerController(req: BusinessRequest, res: Response, next: NextFunction) {
  try {
    const data = await deleteBusinessCustomer(biz(req), String(req.params.id));
    res.json({ success: true, message: "Customer archived successfully", data });
  } catch (e) { next(e); }
}
