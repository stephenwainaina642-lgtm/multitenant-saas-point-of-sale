import { Router } from "express";
import { authenticate } from "../auth/auth.middleware.js";
import { requireBusinessAccess, type BusinessRequest } from "../auth/business.middleware.js";
import { billingSummaryFor } from "../platform/billing.js";

/**
 * What a business owner sees about their own subscription: plan, status, renewal date, limits and what they have used,
 * and receipts. Read-only and owner-only; it stays reachable when the subscription is restricted so it can be renewed.
 * Plan changes and payments are made by the platform owner, never from here.
 */
const router = Router();
router.get("/", authenticate, requireBusinessAccess, async (req: BusinessRequest, res, next) => {
  try {
    if (!req.isBusinessOwner) return res.status(403).json({ success: false, message: "Only the business owner can see billing" });
    res.json({ success: true, data: await billingSummaryFor(req.businessId!) });
  } catch (e) { next(e); }
});
export default router;
