import { Router } from "express";
import { authenticate } from "../auth/auth.middleware.js";
import { requireBusinessAccess } from "../auth/business.middleware.js";
import { requirePermission } from "../auth/permissions.js";
import {
  getQuotationsController,
  getQuotationByIdController,
  createQuotationController,
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

export default router;
