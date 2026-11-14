import { Router } from "express";
import { authenticate } from "../auth/auth.middleware.js";
import { requireBusinessAccess } from "../auth/business.middleware.js";
import { requirePermission } from "../auth/permissions.js";
import {
  getPaymentsController,
  createPaymentController,
} from "./payment.controller.js";

const router = Router();

router.get(
  "/",
  authenticate,
  requireBusinessAccess,
  requirePermission("payments.view"),
  getPaymentsController
);

router.post(
  "/",
  authenticate,
  requireBusinessAccess,
  requirePermission("payments.create"),
  createPaymentController
);

export default router;
