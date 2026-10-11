import { Router } from "express";
import { authenticate } from "../auth/auth.middleware.js";
import { requireBusinessAccess } from "../auth/business.middleware.js";
import {
  getPurchasesController,
  createPurchaseController,
} from "./purchase.controller.js";

const router = Router();

router.get(
  "/",
  authenticate,
  requireBusinessAccess,
  getPurchasesController
);

router.post(
  "/",
  authenticate,
  requireBusinessAccess,
  createPurchaseController
);

export default router;
