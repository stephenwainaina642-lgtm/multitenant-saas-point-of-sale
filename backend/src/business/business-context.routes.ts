import { Router } from "express";
import { authenticate } from "../auth/auth.middleware.js";
import { selectBusinessController } from "./business-context.controller.js";

const router = Router();

router.post(
  "/select",
  authenticate,
  selectBusinessController
);

export default router;