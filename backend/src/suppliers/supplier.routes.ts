import { Router } from "express";
import { authenticate } from "../auth/auth.middleware.js";
import { requireBusinessAccess } from "../auth/business.middleware.js";
import { requirePermission } from "../auth/permissions.js";
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
  requirePermission("suppliers.view"),
  getSuppliersController
);

router.post(
  "/",
  authenticate,
  requireBusinessAccess,
  requirePermission("suppliers.manage"),
  createSupplierController
);

router.put(
  "/:id",
  authenticate,
  requireBusinessAccess,
  requirePermission("suppliers.manage"),
  updateSupplierController
);

router.delete(
  "/:id",
  authenticate,
  requireBusinessAccess,
  requirePermission("suppliers.manage"),
  deleteSupplierController
);

export default router;
