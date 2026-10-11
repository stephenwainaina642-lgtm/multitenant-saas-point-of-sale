import { Router } from "express";
import { authenticate } from "../auth/auth.middleware.js";
import { requireBusinessAccess } from "../auth/business.middleware.js";
import {
  getPaymentsController,
  createPaymentController,
} from "./payment.controller.js";

const router = Router();

router.get(
  "/",
  authenticate,
  requireBusinessAccess,
  getPaymentsController
);

router.post(
  "/",
  authenticate,
  requireBusinessAccess,
  createPaymentController
);

export default router;
