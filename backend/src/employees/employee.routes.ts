import { Router } from "express";
import { authenticate } from "../auth/auth.middleware.js";
import { requireBusinessAccess } from "../auth/business.middleware.js";
import { requirePermission } from "../auth/permissions.js";
import * as c from "./employee.controller.js";

const router = Router();
const guard = [authenticate, requireBusinessAccess, requirePermission("employees.manage")];

router.get("/", ...guard, c.listEmployeesController);
router.post("/", ...guard, c.addEmployeeController);
router.put("/:id", ...guard, c.updateEmployeeController);
router.post("/:id/deactivate", ...guard, c.deactivateEmployeeController);
router.post("/:id/activate", ...guard, c.activateEmployeeController);
router.post("/:id/reset-password", ...guard, c.resetPasswordController);

export default router;
