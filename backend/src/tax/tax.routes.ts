import { Router, type NextFunction, type Response } from "express";
import { authenticate } from "../auth/auth.middleware.js";
import { requireBusinessAccess, type BusinessRequest } from "../auth/business.middleware.js";
import { requirePermission } from "../auth/permissions.js";
import { createTaxRate, deleteTaxRate, listTaxRates, updateTaxRate } from "./tax.service.js";

const router = Router();
const base = [authenticate, requireBusinessAccess];
const biz = (req: BusinessRequest) => req.businessId!.toString();
const wrap = (fn: (req: BusinessRequest, res: Response) => Promise<void>) =>
  (req: BusinessRequest, res: Response, next: NextFunction) => { fn(req, res).catch(next); };

router.get("/", ...base, requirePermission("products.view", "products.manage", "sales.create", "settings.manage", "reports.view"),
  wrap(async (req, res) => { res.json({ success: true, data: await listTaxRates(biz(req)) }); }));
router.post("/", ...base, requirePermission("settings.manage"),
  wrap(async (req, res) => { res.status(201).json({ success: true, data: await createTaxRate(biz(req), req.body ?? {}) }); }));
router.put("/:code", ...base, requirePermission("settings.manage"),
  wrap(async (req, res) => { res.json({ success: true, data: await updateTaxRate(biz(req), String(req.params.code), req.body ?? {}) }); }));
router.delete("/:code", ...base, requirePermission("settings.manage"),
  wrap(async (req, res) => { await deleteTaxRate(biz(req), String(req.params.code)); res.json({ success: true, message: "Tax rate deleted" }); }));

export default router;
