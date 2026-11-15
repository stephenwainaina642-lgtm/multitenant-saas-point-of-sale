import { Router } from "express";
import { authenticate } from "../auth/auth.middleware.js";
import { requireBusinessAccess } from "../auth/business.middleware.js";
import { requirePermission } from "../auth/permissions.js";
import {
  getQuotationsController,
  getQuotationByIdController,
  createQuotationController,
  updateQuotationController,
  quotationStatusController,
  convertQuotationController,
} from "./quotation.controller.js";

const router = Router();

router.get(
  "/",
  authenticate,
  requireBusinessAccess,
  requirePermission("quotations.view"),
  getQuotationsController
);

router.get(
  "/:id",
  authenticate,
  requireBusinessAccess,
  requirePermission("quotations.view"),
  getQuotationByIdController
);

router.post(
  "/",
  authenticate,
  requireBusinessAccess,
  requirePermission("quotations.manage"),
  createQuotationController
);

router.put("/:id", authenticate, requireBusinessAccess, requirePermission("quotations.manage"), updateQuotationController);
router.post("/:id/status", authenticate, requireBusinessAccess, requirePermission("quotations.manage"), quotationStatusController);
router.post("/:id/convert", authenticate, requireBusinessAccess, requirePermission("quotations.manage"), convertQuotationController);

export default router;
