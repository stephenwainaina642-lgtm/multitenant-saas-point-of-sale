import type { NextFunction, Response } from "express";
import type { BusinessRequest } from "../auth/business.middleware.js";
import {
  addEmployee, listEmployees, resetEmployeePassword, setEmployeeActive, updateEmployee,
} from "./employee.service.js";

const biz = (req: BusinessRequest) => req.businessId!.toString();
const actor = (req: BusinessRequest) => ({ userId: BigInt(req.user!.userId) });
const id = (req: BusinessRequest) => String(req.params.id);

export async function listEmployeesController(req: BusinessRequest, res: Response, next: NextFunction) {
  try { res.json({ success: true, data: await listEmployees(biz(req)) }); } catch (e) { next(e); }
}
export async function addEmployeeController(req: BusinessRequest, res: Response, next: NextFunction) {
  try {
    const r = await addEmployee(biz(req), req.body ?? {}, actor(req));
    res.status(201).json({ success: true, message: "Employee added", data: r.employee, temporaryPassword: r.temporaryPassword });
  } catch (e) { next(e); }
}
export async function updateEmployeeController(req: BusinessRequest, res: Response, next: NextFunction) {
  try { res.json({ success: true, message: "Employee updated", data: await updateEmployee(biz(req), id(req), req.body ?? {}, actor(req)) }); } catch (e) { next(e); }
}
export async function deactivateEmployeeController(req: BusinessRequest, res: Response, next: NextFunction) {
  try { res.json({ success: true, data: await setEmployeeActive(biz(req), id(req), false, actor(req)) }); } catch (e) { next(e); }
}
export async function activateEmployeeController(req: BusinessRequest, res: Response, next: NextFunction) {
  try { res.json({ success: true, data: await setEmployeeActive(biz(req), id(req), true, actor(req)) }); } catch (e) { next(e); }
}
export async function resetPasswordController(req: BusinessRequest, res: Response, next: NextFunction) {
  try {
    const r = await resetEmployeePassword(biz(req), id(req), actor(req));
    res.json({ success: true, temporaryPassword: r.temporaryPassword });
  } catch (e) { next(e); }
}
