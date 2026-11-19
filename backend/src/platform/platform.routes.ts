import { Router } from "express";
import type { Response, NextFunction } from "express";
import { clearSessionCookie, issueSession, PLATFORM_COOKIE, PLATFORM_COOKIE_PATH } from "../lib/session-cookie.js";
import { requirePlatformAdmin, platformLogin, type PlatformRequest } from "./platform.auth.js";
import { auditTrail, overview, resetOwnerAccess, setBusinessActive } from "./platform.service.js";

const router = Router();
const wrap = (fn: (req: PlatformRequest, res: Response) => Promise<unknown>) => (req: PlatformRequest, res: Response, next: NextFunction) => { fn(req, res).catch(next); };
const str = (v: unknown) => (typeof v === "string" ? v : "");
const idParam = (req: PlatformRequest) => String(req.params.id ?? "");

router.post("/login", wrap(async (req, res) => {
  const r = await platformLogin(str(req.body?.email), str(req.body?.password), str(req.body?.code));
  res.json({ success: true, message: "Signed in", data: issueSession(req, res, r, PLATFORM_COOKIE, PLATFORM_COOKIE_PATH) });
}));
router.post("/logout", (_req, res) => { clearSessionCookie(res, PLATFORM_COOKIE, PLATFORM_COOKIE_PATH); res.json({ success: true, message: "Signed out" }); });

router.use(requirePlatformAdmin);
router.get("/me", wrap(async (req, res) => { res.json({ success: true, data: req.admin && { name: req.admin.name, email: req.admin.email } }); }));
router.get("/overview", wrap(async (_req, res) => { res.json({ success: true, data: await overview() }); }));
router.get("/audit", wrap(async (req, res) => { res.json({ success: true, data: await auditTrail(Number(req.query.limit) || 100) }); }));
router.post("/businesses/:id/suspend", wrap(async (req, res) => {
  res.json({ success: true, message: "Business suspended", data: await setBusinessActive(req.admin!.id, idParam(req), false, req.body?.reason) });
}));
router.post("/businesses/:id/reactivate", wrap(async (req, res) => {
  res.json({ success: true, message: "Business reactivated", data: await setBusinessActive(req.admin!.id, idParam(req), true, req.body?.reason) });
}));
router.post("/businesses/:id/reset-owner", wrap(async (req, res) => {
  res.json({ success: true, message: "Owner access reset", data: await resetOwnerAccess(req.admin!.id, idParam(req), req.body?.reason) });
}));

export default router;
