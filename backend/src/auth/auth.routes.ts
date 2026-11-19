import { Router } from "express";
import { changePasswordController, loginController, logoutController } from "./auth.controller.js";
import { authenticate } from "./auth.middleware.js";
import { registerController } from "./register.controller.js";
import { capabilitiesController, forgotPasswordController, resetPasswordController } from "./password-reset.js";

const router = Router();

router.post("/login", loginController);
router.post("/register", registerController);
router.post("/logout", logoutController);
router.post("/change-password", authenticate, changePasswordController);
router.get("/capabilities", capabilitiesController);
router.post("/forgot-password", forgotPasswordController);
router.post("/reset-password", resetPasswordController);

export default router;