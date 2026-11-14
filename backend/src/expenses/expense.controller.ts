import type { NextFunction, Response } from "express";
import type { BusinessRequest } from "../auth/business.middleware.js";
import {
  createBusinessExpense, deleteBusinessExpense, getBusinessExpenseById, getBusinessExpenses, updateBusinessExpense,
} from "./expense.service.js";

const biz = (req: BusinessRequest) => req.businessId!.toString();
const uid = (req: BusinessRequest) => (req.user ? String(req.user.userId) : undefined);

export async function getExpensesController(req: BusinessRequest, res: Response, next: NextFunction) {
  try { res.json({ success: true, message: "Expenses retrieved successfully", data: await getBusinessExpenses(biz(req)) }); } catch (e) { next(e); }
}
export async function getExpenseByIdController(req: BusinessRequest, res: Response, next: NextFunction) {
  try { res.json({ success: true, message: "Expense retrieved successfully", data: await getBusinessExpenseById(biz(req), String(req.params.id)) }); } catch (e) { next(e); }
}
export async function createExpenseController(req: BusinessRequest, res: Response, next: NextFunction) {
  try { res.status(201).json({ success: true, message: "Expense created successfully", data: await createBusinessExpense(biz(req), req.body ?? {}, uid(req)) }); } catch (e) { next(e); }
}
export async function updateExpenseController(req: BusinessRequest, res: Response, next: NextFunction) {
  try { res.json({ success: true, message: "Expense updated successfully", data: await updateBusinessExpense(biz(req), String(req.params.id), req.body ?? {}, uid(req)) }); } catch (e) { next(e); }
}
export async function deleteExpenseController(req: BusinessRequest, res: Response, next: NextFunction) {
  try { res.json({ success: true, message: "Expense deleted", data: await deleteBusinessExpense(biz(req), String(req.params.id), req.body?.reason, uid(req)) }); } catch (e) { next(e); }
}
