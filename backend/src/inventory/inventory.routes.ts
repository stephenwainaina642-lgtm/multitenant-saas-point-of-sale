import { Router } from "express";
import { authenticate } from "../auth/auth.middleware.js";
import { requireBusinessAccess } from "../auth/business.middleware.js";
import {
  getInventoryController,
  createInventoryController,
} from "./inventory.controller.js";

const router = Router();

router.get(
  "/",
  authenticate,
  requireBusinessAccess,
  getInventoryController
);

router.post(
  "/",
  authenticate,
  requireBusinessAccess,
  createInventoryController
);

export default router;
