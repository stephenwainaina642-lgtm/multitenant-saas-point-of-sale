import { Router } from "express";
import type { NextFunction, Response } from "express";
import { authenticate } from "../auth/auth.middleware.js";
import { requireBusinessAccess, type BusinessRequest } from "../auth/business.middleware.js";
import { requirePermission } from "../auth/permissions.js";
import { assignStaff, createBranch, createTransfer, listBranches, listTransfers, stockByBranch, updateBranch } from "./branch.service.js";

const router = Router();
router.use(authenticate, requireBusinessAccess);

type Req = BusinessRequest;
const wrap = (fn: (req: Req, res: Response) => Promise<unknown>) => (req: Req, res: Response, next: NextFunction) => { fn(req, res).catch(next); };
const biz = (req: Req) => req.businessId!;
const uid = (req: Req) => req.user!.userId;
const actor = (req: Req) => ({ userId: uid(req), canSeeAll: Boolean(req.permissions?.has("branches.all")), branchId: req.branchId! });

router.get("/", wrap(async (req, res) => { res.json({ success: true, data: await listBranches(biz(req), actor(req)) }); }));
router.post("/", requirePermission("branches.manage"), wrap(async (req, res) => {
  res.status(201).json({ success: true, message: "Branch created", data: await createBranch(biz(req), uid(req), req.body ?? {}) });
}));
router.get("/stock", requirePermission("products.view", "inventory.view"), wrap(async (req, res) => {
  // ?current=1: only the branch this request works in (the till uses this).
  const a = actor(req);
  res.json({ success: true, data: await stockByBranch(biz(req), req.query.current === "1" ? { ...a, canSeeAll: false } : a) });
}));
router.put("/staff/:userId", requirePermission("branches.manage"), wrap(async (req, res) => {
  res.json({ success: true, message: "Staff assignment saved", data: await assignStaff(biz(req), uid(req), req.params.userId, req.body?.branchId) });
}));
router.get("/transfers", requirePermission("stock.transfer", "inventory.view"), wrap(async (req, res) => { res.json({ success: true, data: await listTransfers(biz(req), actor(req)) }); }));
router.post("/transfers", requirePermission("stock.transfer"), wrap(async (req, res) => {
  const header = req.headers["idempotency-key"];
  const data = await createTransfer(biz(req), actor(req), req.body ?? {}, Array.isArray(header) ? undefined : header);
  res.status(201).json({ success: true, message: "Stock transferred", data });
}));
const update = wrap(async (req, res) => {
  res.json({ success: true, message: "Branch updated", data: await updateBranch(biz(req), uid(req), req.params.id, req.body ?? {}) });
});
router.patch("/:id", requirePermission("branches.manage"), update);
router.put("/:id", requirePermission("branches.manage"), update); // the web app only sends PUT

export default router;
