import { Router } from "express";
import { authenticate } from "../auth/auth.middleware.js";
import { requireBusinessAccess } from "../auth/business.middleware.js";
import { requirePermission } from "../auth/permissions.js";
import { getAuditLogsController } from "./audit.controller.js";

const router = Router();

router.get("/", authenticate, requireBusinessAccess,
  requirePermission("audit.view"), getAuditLogsController);

export default router;
