import { Router } from "express";
import { authenticate } from "../auth/auth.middleware.js";
import { requireBusinessAccess } from "../auth/business.middleware.js";
import {
  getSuppliersController,
  createSupplierController,
  updateSupplierController,
  deleteSupplierController,
} from "./supplier.controller.js";

const router = Router();

router.get(
  "/",
  authenticate,
  requireBusinessAccess,
  getSuppliersController
);

router.post(
  "/",
  authenticate,
  requireBusinessAccess,
  createSupplierController
);

router.put(
  "/:id",
  authenticate,
  requireBusinessAccess,
  updateSupplierController
);

router.delete(
  "/:id",
  authenticate,
  requireBusinessAccess,
  deleteSupplierController
);

export default router;
