import { Router } from "express";
import { authenticate } from "../auth/auth.middleware.js";
import { requireBusinessAccess } from "../auth/business.middleware.js";
import { requirePermission } from "../auth/permissions.js";
import * as c from "./employee.controller.js";
import { cancelEmployeeInvite, createEmployeeInvite, listEmployeeInvites } from "./employee-invites.js";

const router = Router();
const guard = [authenticate, requireBusinessAccess, requirePermission("employees.manage")];

const actorOf = (req: any) => ({ userId: BigInt(req.user!.userId), permissions: req.permissions, isOwner: req.isBusinessOwner });
router.get("/invites", ...guard, async (req: any, res, next) => { try { res.json({ success: true, data: await listEmployeeInvites(req.businessId!.toString()) }); } catch (e) { next(e); } });
router.post("/invites", ...guard, async (req: any, res, next) => { try { res.status(201).json({ success: true, message: "Sign-in link created", data: await createEmployeeInvite(req.businessId!.toString(), req.body ?? {}, actorOf(req)) }); } catch (e) { next(e); } });
router.post("/invites/:id/cancel", ...guard, async (req: any, res, next) => { try { await cancelEmployeeInvite(req.businessId!.toString(), String(req.params.id), actorOf(req)); res.json({ success: true, message: "Sign-in link cancelled" }); } catch (e) { next(e); } });
router.get("/", ...guard, c.listEmployeesController);
router.get("/:id/profile", ...guard, c.employeeProfileController);
router.post("/", ...guard, c.addEmployeeController);
router.put("/:id", ...guard, c.updateEmployeeController);
router.post("/:id/deactivate", ...guard, c.deactivateEmployeeController);
router.post("/:id/activate", ...guard, c.activateEmployeeController);
router.post("/:id/reset-password", ...guard, c.resetPasswordController);

export default router;
