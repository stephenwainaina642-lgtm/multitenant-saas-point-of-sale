import { Router } from "express";
import { authenticate } from "../auth/auth.middleware.js";
import { requireBusinessAccess } from "../auth/business.middleware.js";
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
  getSalesController
);

router.get(
  "/:id",
  authenticate,
  requireBusinessAccess,
  getSaleByIdController
);

router.post(
  "/",
  authenticate,
  requireBusinessAccess,
  createSaleController
);

export default router;
