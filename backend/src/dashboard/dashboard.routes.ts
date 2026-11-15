import { Router } from "express";
import { authenticate } from "../auth/auth.middleware.js";
import { requireBusinessAccess } from "../auth/business.middleware.js";
import { getDashboardController } from "./dashboard.controller.js";

const router = Router();

// No single permission gates the dashboard: each section is returned only if the caller may see it.
router.get("/", authenticate, requireBusinessAccess, getDashboardController);

export default router;
