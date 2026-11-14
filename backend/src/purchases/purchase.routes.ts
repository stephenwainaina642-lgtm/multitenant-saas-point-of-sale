import { Router } from "express";
import { authenticate } from "../auth/auth.middleware.js";
import { requireBusinessAccess } from "../auth/business.middleware.js";
import { requirePermission } from "../auth/permissions.js";
import {
  getPurchasesController,
  createPurchaseController,
  getPurchaseController,
  payPurchaseController,
  voidPurchaseController,
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

router.get("/:id", authenticate, requireBusinessAccess, requirePermission("purchases.view"), getPurchaseController);
router.post("/:id/payments", authenticate, requireBusinessAccess, requirePermission("purchases.pay"), payPurchaseController);
router.post("/:id/void", authenticate, requireBusinessAccess, requirePermission("purchases.void"), voidPurchaseController);

export default router;
