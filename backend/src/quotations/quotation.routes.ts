import { Router } from "express";
import { authenticate } from "../auth/auth.middleware.js";
import { requireBusinessAccess } from "../auth/business.middleware.js";
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
  getQuotationsController
);

router.get(
  "/:id",
  authenticate,
  requireBusinessAccess,
  getQuotationByIdController
);

router.post(
  "/",
  authenticate,
  requireBusinessAccess,
  createQuotationController
);

export default router;
