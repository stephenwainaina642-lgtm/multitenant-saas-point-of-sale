import { Router } from "express";
import { authenticate } from "../auth/auth.middleware.js";
import { requireBusinessAccess } from "../auth/business.middleware.js";
import {
  getExpensesController,
  getExpenseByIdController,
  createExpenseController,
} from "./expense.controller.js";

const router = Router();

router.get(
  "/",
  authenticate,
  requireBusinessAccess,
  getExpensesController
);

router.get(
  "/:id",
  authenticate,
  requireBusinessAccess,
  getExpenseByIdController
);

router.post(
  "/",
  authenticate,
  requireBusinessAccess,
  createExpenseController
);

export default router;
