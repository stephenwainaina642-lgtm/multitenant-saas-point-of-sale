import { Router } from "express";
import type { Response, NextFunction } from "express";
import { clearSessionCookie, issueSession, PLATFORM_COOKIE, PLATFORM_COOKIE_PATH } from "../lib/session-cookie.js";
import { requirePlatformAdmin, platformLogin, type PlatformRequest } from "./platform.auth.js";
import { createInvite, listInvites, revokeInvite } from "./invites.js";
import * as quotes from "./quotes.js";
import * as billing from "./billing.js";
import { auditTrail, deleteBusiness, eraseBusiness, restoreBusiness, overview, resetOwnerAccess, setBusinessActive, setBusinessApproval, setBusinessModules, setBusinessPackage } from "./platform.service.js";
import { MODULE_INFO, PACKAGE_INFO } from "../lib/packages.js";

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
router.post("/businesses/:id/approve", wrap(async (req, res) => {
  res.json({ success: true, message: "Business approved", data: await setBusinessApproval(req.admin!.id, idParam(req), true, req.body?.reason) });
}));
router.post("/businesses/:id/reject", wrap(async (req, res) => {
  res.json({ success: true, message: "Business rejected", data: await setBusinessApproval(req.admin!.id, idParam(req), false, req.body?.reason) });
}));
router.post("/businesses/:id/delete", wrap(async (req, res) => {
  res.json({ success: true, message: "Business deleted", data: await deleteBusiness(req.admin!.id, idParam(req), req.body?.reason) });
}));
router.post("/businesses/:id/restore", wrap(async (req, res) => {
  res.json({ success: true, message: "Business restored", data: await restoreBusiness(req.admin!.id, idParam(req), req.body?.reason) });
}));
router.post("/businesses/:id/erase", wrap(async (req, res) => {
  res.json({ success: true, message: "Business erased", data: await eraseBusiness(req.admin!.id, idParam(req), req.body?.reason, req.body?.confirmName) });
}));
router.get("/invites", wrap(async (_req, res) => { res.json({ success: true, data: await listInvites() }); }));
router.post("/invites", wrap(async (req, res) => { res.status(201).json({ success: true, message: "Invitation created", data: await createInvite(req.admin!.id, req.body ?? {}) }); }));
router.post("/invites/:id/revoke", wrap(async (req, res) => { await revokeInvite(req.admin!.id, idParam(req), req.body?.reason); res.json({ success: true, message: "Invitation cancelled" }); }));
router.post("/businesses/:id/package", wrap(async (req, res) => {
  res.json({ success: true, message: "Package changed", data: await setBusinessPackage(req.admin!.id, idParam(req), req.body?.package, req.body?.reason) });
}));
router.post("/businesses/:id/modules", wrap(async (req, res) => {
  res.json({ success: true, message: "Modules updated", data: await setBusinessModules(req.admin!.id, idParam(req), req.body?.modules, req.body?.reason) });
}));
router.get("/packages", wrap(async (_req, res) => { res.json({ success: true, data: { packages: PACKAGE_INFO, modules: MODULE_INFO } }); }));
router.post("/businesses/:id/reset-owner", wrap(async (req, res) => {
  res.json({ success: true, message: "Owner access reset", data: await resetOwnerAccess(req.admin!.id, idParam(req), req.body?.reason) });
}));

// ---- quotations (installations, trainings...) ----
const ok = (res: Response, data: unknown, status = 200, message = "OK") => res.status(status).json({ success: true, message, data });
router.get("/quote-settings", wrap(async (_req, res) => ok(res, await quotes.getSettings())));
router.put("/quote-settings", wrap(async (req, res) => ok(res, await quotes.updateSettings(req.admin!.id, req.body ?? {}))));
router.get("/quote-services", wrap(async (_req, res) => ok(res, await quotes.listServices())));
router.post("/quote-services", wrap(async (req, res) => ok(res, await quotes.createService(req.admin!.id, req.body ?? {}), 201)));
router.put("/quote-services/:id", wrap(async (req, res) => ok(res, await quotes.updateService(req.admin!.id, idParam(req), req.body ?? {}))));
router.delete("/quote-services/:id", wrap(async (req, res) => { await quotes.deleteService(req.admin!.id, idParam(req)); ok(res, null); }));
router.get("/quotes", wrap(async (req, res) => ok(res, await quotes.listQuotes({ status: str(req.query.status), q: str(req.query.q) }))));
router.post("/quotes", wrap(async (req, res) => ok(res, await quotes.createQuote(req.admin!.id, req.body ?? {}), 201)));
router.get("/quotes/:id", wrap(async (req, res) => ok(res, await quotes.getQuote(idParam(req)))));
router.put("/quotes/:id", wrap(async (req, res) => ok(res, await quotes.updateQuote(req.admin!.id, idParam(req), req.body ?? {}))));
router.delete("/quotes/:id", wrap(async (req, res) => { await quotes.deleteQuote(req.admin!.id, idParam(req)); ok(res, null); }));
router.post("/quotes/:id/send", wrap(async (req, res) => ok(res, await quotes.sendQuote(req.admin!.id, idParam(req)))));
router.post("/quotes/:id/accept", wrap(async (req, res) => ok(res, await quotes.acceptQuote(req.admin!.id, idParam(req)))));
router.post("/quotes/:id/decline", wrap(async (req, res) => ok(res, await quotes.declineQuote(req.admin!.id, idParam(req)))));
router.post("/quotes/:id/reopen", wrap(async (req, res) => ok(res, await quotes.reopenQuote(req.admin!.id, idParam(req)))));
router.post("/quotes/:id/duplicate", wrap(async (req, res) => ok(res, await quotes.duplicateQuote(req.admin!.id, idParam(req)), 201)));

// ---- plans, subscriptions and manual payments ----
router.get("/plans", wrap(async (_req, res) => ok(res, await billing.listPlans())));
router.post("/plans", wrap(async (req, res) => ok(res, await billing.createPlan(req.admin!.id, req.body ?? {}), 201)));
router.put("/plans/:id", wrap(async (req, res) => ok(res, await billing.updatePlan(req.admin!.id, idParam(req), req.body ?? {}))));
router.post("/plans/:id/archive", wrap(async (req, res) => ok(res, await billing.archivePlan(req.admin!.id, idParam(req), true))));
router.post("/plans/:id/unarchive", wrap(async (req, res) => ok(res, await billing.archivePlan(req.admin!.id, idParam(req), false))));
router.delete("/plans/:id", wrap(async (req, res) => { await billing.deletePlan(req.admin!.id, idParam(req)); ok(res, null); }));
router.get("/subscriptions", wrap(async (_req, res) => ok(res, await billing.listSubscriptions())));
router.get("/businesses/:id/subscription", wrap(async (req, res) => ok(res, await billing.subscriptionDetail(idParam(req)))));
router.post("/businesses/:id/subscription", wrap(async (req, res) => ok(res, await billing.assignPlan(req.admin!.id, idParam(req), req.body ?? {}))));
router.put("/businesses/:id/subscription", wrap(async (req, res) => ok(res, await billing.updateSubscriptionTerms(req.admin!.id, idParam(req), req.body ?? {}))));
router.post("/businesses/:id/subscription/suspend", wrap(async (req, res) => ok(res, await billing.suspendSubscription(req.admin!.id, idParam(req), req.body?.reason))));
router.post("/businesses/:id/subscription/reactivate", wrap(async (req, res) => ok(res, await billing.reactivateSubscription(req.admin!.id, idParam(req), req.body?.reason))));
router.post("/businesses/:id/subscription/cancel", wrap(async (req, res) => ok(res, await billing.cancelSubscription(req.admin!.id, idParam(req), req.body?.reason))));
router.post("/businesses/:id/subscription/extend", wrap(async (req, res) => ok(res, await billing.extendSubscription(req.admin!.id, idParam(req), req.body?.days, req.body?.reason))));
router.post("/businesses/:id/payments", wrap(async (req, res) => ok(res, await billing.recordPayment(req.admin!.id, idParam(req), req.body ?? {}), 201)));
router.get("/payments", wrap(async (req, res) => ok(res, await billing.listPayments({ status: str(req.query.status), ...(Number(req.query.limit) ? { limit: Number(req.query.limit) } : {}) }))));
router.post("/payments/:id/approve", wrap(async (req, res) => ok(res, await billing.approvePayment(req.admin!.id, idParam(req), req.body?.reason))));
router.post("/payments/:id/reject", wrap(async (req, res) => ok(res, await billing.rejectPayment(req.admin!.id, idParam(req), req.body?.reason))));
router.post("/payments/:id/refund", wrap(async (req, res) => ok(res, await billing.refundPayment(req.admin!.id, idParam(req), req.body?.reason))));

export default router;
