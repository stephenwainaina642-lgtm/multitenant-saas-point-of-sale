import { Router } from "express";
import { authenticate } from "../auth/auth.middleware.js";
import { requireBusinessAccess } from "../auth/business.middleware.js";
import { requirePermission } from "../auth/permissions.js";
import {
  getSalesController,
  getSaleByIdController,
  createSaleController,
  editSaleController,
  voidSaleController,
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

router.put(
  "/:id",
  authenticate,
  requireBusinessAccess,
  requirePermission("sales.edit"),
  editSaleController
);

router.post(
  "/:id/void",
  authenticate,
  requireBusinessAccess,
  requirePermission("sales.void"),
  voidSaleController
);

export default router;
