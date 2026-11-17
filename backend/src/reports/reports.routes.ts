import { Router } from "express";
import { authenticate } from "../auth/auth.middleware.js";
import { requireBusinessAccess } from "../auth/business.middleware.js";
import { requirePermission } from "../auth/permissions.js";
import { getReportsController, getVatReportController } from "./reports.controller.js";

const router = Router();

router.get(
  "/",
  authenticate,
  requireBusinessAccess,
  requirePermission("reports.view"),
  getReportsController
);

router.get(
  "/vat",
  authenticate,
  requireBusinessAccess,
  requirePermission("reports.view"),
  getVatReportController
);

export default router;
