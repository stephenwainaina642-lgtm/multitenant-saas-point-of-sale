import { Router } from "express";
import { authenticate } from "../auth/auth.middleware.js";
import { requireBusinessAccess } from "../auth/business.middleware.js";
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
  getProductsController
);

router.post(
  "/",
  authenticate,
  requireBusinessAccess,
  createProductController
);

router.put(
  "/:id",
  authenticate,
  requireBusinessAccess,
  updateProductController
);

router.delete(
  "/:id",
  authenticate,
  requireBusinessAccess,
  deleteProductController
);

export default router;