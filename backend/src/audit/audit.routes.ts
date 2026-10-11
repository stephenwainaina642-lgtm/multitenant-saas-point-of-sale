import { Router } from "express";
import {
  getAuditLogsController,
} from "./audit.controller.js";

const router = Router();

router.get("/", getAuditLogsController);

export default router;
