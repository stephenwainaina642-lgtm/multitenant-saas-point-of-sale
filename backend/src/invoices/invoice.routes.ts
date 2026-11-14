import { Router } from "express";
import { authenticate } from "../auth/auth.middleware.js";
import { requireBusinessAccess } from "../auth/business.middleware.js";
import { requirePermission } from "../auth/permissions.js";
import {
  getInvoicesController,
  getInvoiceByIdController,
  createInvoiceController,
} from "./invoice.controller.js";

const router = Router();

router.get(
  "/",
  authenticate,
  requireBusinessAccess,
  requirePermission("invoices.view"),
  getInvoicesController
);

router.get(
  "/:id",
  authenticate,
  requireBusinessAccess,
  requirePermission("invoices.view"),
  getInvoiceByIdController
);

router.post(
  "/",
  authenticate,
  requireBusinessAccess,
  requirePermission("invoices.manage"),
  createInvoiceController
);

export default router;
