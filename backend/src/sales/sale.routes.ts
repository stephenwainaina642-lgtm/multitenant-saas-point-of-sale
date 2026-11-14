import { Router } from "express";
import { authenticate } from "../auth/auth.middleware.js";
import { requireBusinessAccess } from "../auth/business.middleware.js";
import { requirePermission } from "../auth/permissions.js";
import {
  getSalesController,
  getSaleByIdController,
  createSaleController,
} from "./sale.controller.js";

const router = Router();

router.get(
  "/",
  authenticate,
  requireBusinessAccess,
  requirePermission("sales.view_all", "sales.view_own"),
  getSalesController
);

router.get(
  "/:id",
  authenticate,
  requireBusinessAccess,
  requirePermission("sales.view_all", "sales.view_own"),
  getSaleByIdController
);

router.post(
  "/",
  authenticate,
  requireBusinessAccess,
  requirePermission("sales.create"),
  createSaleController
);

export default router;
