import { Router } from "express";
import { authenticate } from "../auth/auth.middleware.js";
import { requireBusinessAccess } from "../auth/business.middleware.js";
import { requirePermission } from "../auth/permissions.js";
import {
  getExpensesController,
  getExpenseByIdController,
  createExpenseController,
  updateExpenseController,
  deleteExpenseController,
} from "./expense.controller.js";

const router = Router();

router.get(
  "/",
  authenticate,
  requireBusinessAccess,
  requirePermission("expenses.view"),
  getExpensesController
);

router.get(
  "/:id",
  authenticate,
  requireBusinessAccess,
  requirePermission("expenses.view"),
  getExpenseByIdController
);

router.post(
  "/",
  authenticate,
  requireBusinessAccess,
  requirePermission("expenses.manage"),
  createExpenseController
);

router.put(
  "/:id",
  authenticate,
  requireBusinessAccess,
  requirePermission("expenses.manage"),
  updateExpenseController
);

router.delete(
  "/:id",
  authenticate,
  requireBusinessAccess,
  requirePermission("expenses.manage"),
  deleteExpenseController
);

export default router;
