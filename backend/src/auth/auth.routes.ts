import { Router } from "express";
import { changePasswordController, loginController, logoutController } from "./auth.controller.js";
import { authenticate } from "./auth.middleware.js";
import { loadConfig } from "../lib/config.js";
import { inviteInfo } from "../platform/invites.js";
import { registerController } from "./register.controller.js";
import { capabilitiesController, forgotPasswordController, resetPasswordController } from "./password-reset.js";

const router = Router();

router.post("/login", loginController);
router.post("/register", registerController);
// Sign-up page support: is open sign-up on, and what is this invitation link for?
router.get("/signup-mode", (_req, res) => { res.json({ success: true, data: { open: loadConfig().openRegistration } }); });
router.get("/invite/:token", async (req, res, next) => {
  try { res.json({ success: true, data: await inviteInfo(req.params.token) }); } catch (e) { next(e); }
});
router.post("/logout", logoutController);
router.post("/change-password", authenticate, changePasswordController);
router.get("/capabilities", capabilitiesController);
router.post("/forgot-password", forgotPasswordController);
router.post("/reset-password", resetPasswordController);

export default router;