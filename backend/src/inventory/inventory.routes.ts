import { Router } from "express";
import { authenticate } from "../auth/auth.middleware.js";
import { requireBusinessAccess } from "../auth/business.middleware.js";
import { requirePermission } from "../auth/permissions.js";
import {
  getInventoryController,
  createInventoryController,
} from "./inventory.controller.js";

const router = Router();

router.get("/", authenticate, requireBusinessAccess,
  requirePermission("inventory.view"), getInventoryController);

router.post("/", authenticate, requireBusinessAccess,
  requirePermission("inventory.adjust"), createInventoryController);

export default router;
