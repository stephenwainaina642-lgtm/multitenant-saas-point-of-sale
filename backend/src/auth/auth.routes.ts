import { Router } from "express";
import { loginController } from "./auth.controller.js";
import { registerController } from "./register.controller.js";

const router = Router();

router.post("/login", loginController);
router.post("/register", registerController);

export default router;