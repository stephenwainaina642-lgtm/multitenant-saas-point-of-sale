import { Router } from "express";
import { authenticate } from "../auth/auth.middleware.js";
import { requireBusinessAccess } from "../auth/business.middleware.js";
import { requirePermission } from "../auth/permissions.js";
import {
  getPurchasesController,
  createPurchaseController,
} from "./purchase.controller.js";

const router = Router();

router.get(
  "/",
  authenticate,
  requireBusinessAccess,
  requirePermission("purchases.view"),
  getPurchasesController
);

router.post(
  "/",
  authenticate,
  requireBusinessAccess,
  requirePermission("purchases.create"),
  createPurchaseController
);

export default router;
