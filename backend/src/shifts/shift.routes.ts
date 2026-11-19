import { Router } from "express";
import type { NextFunction, Response } from "express";
import { authenticate } from "../auth/auth.middleware.js";
import { requireBusinessAccess, type BusinessRequest } from "../auth/business.middleware.js";
import { requirePermission } from "../auth/permissions.js";
import { closeShift, currentShift, getShift, listShifts, openShift, setManagerNote } from "./shift.service.js";

const router = Router();
router.use(authenticate, requireBusinessAccess);

type Req = BusinessRequest & { user?: { userId: string }; permissions?: Set<string> };
const wrap = (fn: (req: Req, res: Response) => Promise<unknown>) => (req: Req, res: Response, next: NextFunction) => { fn(req, res).catch(next); };
const biz = (req: Req) => req.businessId!.toString();
const uid = (req: Req) => req.user!.userId;
const canSeeAll = (req: Req) => Boolean(req.permissions?.has("shifts.view_all"));
const idOf = (req: Req) => String(req.params.id ?? "");

router.get("/current", requirePermission("shifts.use"), wrap(async (req, res) => { res.json({ success: true, data: await currentShift(biz(req), uid(req)) }); }));
router.post("/open", requirePermission("shifts.use"), wrap(async (req, res) => {
  res.status(201).json({ success: true, message: "Shift opened", data: await openShift(biz(req), uid(req), req.body?.openingFloat, req.branchId) });
}));
router.post("/:id/close", requirePermission("shifts.use"), wrap(async (req, res) => {
  res.json({ success: true, message: "Shift closed", data: await closeShift(biz(req), { userId: uid(req), canSeeAll: canSeeAll(req) }, idOf(req), req.body ?? {}) });
}));
router.get("/", requirePermission("shifts.use", "shifts.view_all"), wrap(async (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  res.json({ success: true, data: await listShifts(biz(req), { userId: uid(req), canSeeAll: canSeeAll(req) }, q) });
}));
router.get("/:id", requirePermission("shifts.use", "shifts.view_all"), wrap(async (req, res) => {
  res.json({ success: true, data: await getShift(biz(req), { userId: uid(req), canSeeAll: canSeeAll(req) }, idOf(req)) });
}));
router.post("/:id/note", requirePermission("shifts.view_all"), wrap(async (req, res) => {
  res.json({ success: true, message: "Note saved", data: await setManagerNote(biz(req), uid(req), idOf(req), req.body?.note) });
}));

export default router;
