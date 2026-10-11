import { Router } from "express";
import { authenticate } from "../auth/auth.middleware.js";
import { requireBusinessAccess } from "../auth/business.middleware.js";
import {
  getInvoicesController,
  getInvoiceByIdController,
  createInvoiceController,
} from "./invoice.controller.js";

const router = Router();

router.get(
  "/",
  authenticate,
  requireBusinessAccess,
  getInvoicesController
);

router.get(
  "/:id",
  authenticate,
  requireBusinessAccess,
  getInvoiceByIdController
);

router.post(
  "/",
  authenticate,
  requireBusinessAccess,
  createInvoiceController
);

export default router;
