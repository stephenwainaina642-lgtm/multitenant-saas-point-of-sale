import { Router } from "express";
import { authenticate } from "../auth/auth.middleware.js";
import { getBusinessesController } from "./business.controller.js";

const router = Router();

router.get(
  "/",
  authenticate,
  getBusinessesController
);

export default router;