import { Router } from "express";
import { authenticate } from "../auth/auth.middleware.js";
import { requireBusinessAccess } from "../auth/business.middleware.js";
import { requirePermission } from "../auth/permissions.js";
import {
  createRoleController,
  deleteRoleController,
  getPermissionCatalogController,
  getRolesController,
  updateRoleController,
} from "./role.controller.js";

const router = Router();
const guard = [authenticate, requireBusinessAccess, requirePermission("roles.manage")];

router.get("/permissions", ...guard, getPermissionCatalogController);
router.get("/", ...guard, getRolesController);
router.post("/", ...guard, createRoleController);
router.put("/:id", ...guard, updateRoleController);
router.delete("/:id", ...guard, deleteRoleController);

export default router;
