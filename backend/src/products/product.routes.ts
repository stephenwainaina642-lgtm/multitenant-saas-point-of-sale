import { Router } from "express";
import { authenticate } from "../auth/auth.middleware.js";
import { requireBusinessAccess } from "../auth/business.middleware.js";
import { requirePermission } from "../auth/permissions.js";
import {
  getProductsController,
  createProductController,
  updateProductController,
  deleteProductController,
} from "./product.controller.js";

const router = Router();

router.get(
  "/",
  authenticate,
  requireBusinessAccess,
  requirePermission("products.view"),
  getProductsController
);

router.post(
  "/",
  authenticate,
  requireBusinessAccess,
  requirePermission("products.manage"),
  createProductController
);

router.put(
  "/:id",
  authenticate,
  requireBusinessAccess,
  requirePermission("products.manage"),
  updateProductController
);

router.delete(
  "/:id",
  authenticate,
  requireBusinessAccess,
  requirePermission("products.manage"),
  deleteProductController
);

export default router;