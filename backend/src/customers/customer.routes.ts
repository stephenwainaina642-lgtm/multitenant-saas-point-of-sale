import { Router } from "express";
import { authenticate } from "../auth/auth.middleware.js";
import { requireBusinessAccess } from "../auth/business.middleware.js";
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
  getCustomersController
);

router.post(
  "/",
  authenticate,
  requireBusinessAccess,
  createCustomerController
);

router.put(
  "/:id",
  authenticate,
  requireBusinessAccess,
  updateCustomerController
);

router.delete(
  "/:id",
  authenticate,
  requireBusinessAccess,
  deleteCustomerController
);

export default router;
