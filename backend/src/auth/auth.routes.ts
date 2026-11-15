import { Router } from "express";
import { changePasswordController, loginController } from "./auth.controller.js";
import { authenticate } from "./auth.middleware.js";
import { registerController } from "./register.controller.js";

const router = Router();

router.post("/login", loginController);
router.post("/register", registerController);
router.post("/change-password", authenticate, changePasswordController);

export default router;