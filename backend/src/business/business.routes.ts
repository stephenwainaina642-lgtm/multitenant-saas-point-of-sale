import { Router } from "express";
import { authenticate } from "../auth/auth.middleware.js";
import { requireBusinessAccess } from "../auth/business.middleware.js";
import {
  getBusinessesController,
  getCurrentBusinessController,
  updateCurrentBusinessController,
} from "./business.controller.js";

const router = Router();

router.get(
  "/",
  authenticate,
  getBusinessesController
);

router.get(
  "/current",
  authenticate,
  requireBusinessAccess,
  getCurrentBusinessController
);

router.put(
  "/current",
  authenticate,
  requireBusinessAccess,
  updateCurrentBusinessController
);

export default router;
