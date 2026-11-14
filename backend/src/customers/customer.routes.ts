import { Router } from "express";
import { authenticate } from "../auth/auth.middleware.js";
import { requireBusinessAccess } from "../auth/business.middleware.js";
import { requirePermission } from "../auth/permissions.js";
import {
  getCustomersController,
  createCustomerController,
  updateCustomerController,
  deleteCustomerController,
} from "./customer.controller.js";

const router = Router();

router.get(
  "/",
  authenticate,
  requireBusinessAccess,
  requirePermission("customers.view"),
  getCustomersController
);

router.post(
  "/",
  authenticate,
  requireBusinessAccess,
  requirePermission("customers.manage"),
  createCustomerController
);

router.put(
  "/:id",
  authenticate,
  requireBusinessAccess,
  requirePermission("customers.manage"),
  updateCustomerController
);

router.delete(
  "/:id",
  authenticate,
  requireBusinessAccess,
  requirePermission("customers.manage"),
  deleteCustomerController
);

export default router;
