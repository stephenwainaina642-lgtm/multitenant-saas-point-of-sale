import { Router } from "express";
import { authenticate } from "../auth/auth.middleware.js";
import { requireBusinessAccess } from "../auth/business.middleware.js";
import { requirePermission } from "../auth/permissions.js";
import {
  getInventoryController,
  createInventoryController,
} from "./inventory.controller.js";

import { listShortfalls, resolveShortfall } from "./shortfalls.js";

const router = Router();

// Offline sales that outran the stock: review (inventory.view), close with a reason (inventory.adjust).
router.get("/offline-shortfalls", authenticate, requireBusinessAccess, requirePermission("inventory.view"), listShortfalls);
router.post("/offline-shortfalls/:id/resolve", authenticate, requireBusinessAccess, requirePermission("inventory.adjust"), resolveShortfall);

router.get("/", authenticate, requireBusinessAccess,
  requirePermission("inventory.view"), getInventoryController);

router.post("/", authenticate, requireBusinessAccess,
  requirePermission("inventory.adjust"), createInventoryController);

export default router;
