import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { authenticate } from "../../auth/auth.middleware.js";
import { requireBusinessAccess } from "../../auth/business.middleware.js";
import { requirePermission } from "../../auth/permissions.js";
import { createPaymentController, getPaymentController, mpesaTillStatusController, mpesaAttentionController, mpesaDismissController, mpesaRestoreController, mpesaCallbackController, c2bRegisterController, c2bSimulateController, c2bStatementController, c2bConfirmationController, c2bValidationController, pesapalRegisterIpnController, pesapalCreateController, pesapalGetController, pesapalTillStatusController, pesapalAttentionController, pesapalDismissController, pesapalRestoreController, pesapalIpnController, pesapalReturnController, disableController, enableController, getController, listController, saveController, testController } from "./integration.controller.js";

const limit = (max: number, windowMs: number, message: string) =>
  rateLimit({
    windowMs,
    limit: max,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    // Runs after authenticate: count per signed-in person, not per shared office IP.
    keyGenerator: (req) => `integrations:${(req as any).user?.userId ?? req.ip}`,
    validate: { keyGeneratorIpFallback: false },
    handler: (_req, res) => { res.status(429).json({ success: false, message }); },
  });

// Changing credentials/state: 30 per 10 minutes. Test connection calls an outside provider: 10 per 10 minutes.
const writeLimiter = limit(Number(process.env.INTEGRATIONS_WRITE_LIMIT) || 30, 10 * 60_000, "Too many changes to integrations. Please wait a few minutes.");
const testLimiter = limit(Number(process.env.INTEGRATIONS_TEST_LIMIT) || 10, 10 * 60_000, "Too many connection tests. Please wait a few minutes.");

const router = Router();
const guard = [authenticate, requireBusinessAccess, requirePermission("integrations.manage")];

// Safaricom's callback: public on purpose, protected by the unguessable token in the URL and an IP rate limit.
const callbackLimiter = rateLimit({ windowMs: 60_000, limit: Number(process.env.MPESA_CALLBACK_LIMIT) || 120, standardHeaders: "draft-7", legacyHeaders: false, handler: (_q, r) => { r.status(429).json({ success: false, message: "Too many requests" }); } });
router.post("/callbacks/mpesa/:token", callbackLimiter, mpesaCallbackController);
// Pesapal's notification (IPN, GET or POST) and the customer's return page: public, same protections.
// Safaricom's C2B notifications (a statement of payments made to the shortcode): public, secret token in the path.
router.post("/callbacks/c2b/:connectionId/:token/confirmation", callbackLimiter, c2bConfirmationController);
router.post("/callbacks/c2b/:connectionId/:token/validation", callbackLimiter, c2bValidationController);
router.all("/callbacks/pesapal/:connectionId/:token", callbackLimiter, pesapalIpnController);
router.get("/pesapal/return", callbackLimiter, pesapalReturnController);

// Asking a customer to pay is a till job, so it follows the payments permission, not integrations.manage.
const payGuard = [authenticate, requireBusinessAccess, requirePermission("payments.create")];
const payLimiter = limit(Number(process.env.MPESA_REQUEST_LIMIT) || 20, 60_000, "Too many payment requests. Wait a minute.");
router.get("/mpesa/status", ...payGuard, mpesaTillStatusController);
// Money that needs a person: confirmed-but-unused payments and "could not confirm" requests. Needs to see all payments.
router.get("/mpesa/attention", authenticate, requireBusinessAccess, requirePermission("payments.view"), mpesaAttentionController);
router.post("/mpesa/payment-requests", ...payGuard, payLimiter, createPaymentController);
router.get("/mpesa/payment-requests/:id", ...payGuard, getPaymentController);

// Closing a payment is a money decision: owner / people explicitly given integrations.manage only.
router.post("/mpesa/payment-requests/:id/dismiss", ...guard, writeLimiter, mpesaDismissController);
router.post("/mpesa/payment-requests/:id/restore", ...guard, writeLimiter, mpesaRestoreController);

// Pesapal hosted checkout. Registering the notification address is a settings job; asking a customer to pay is a till job.
router.post("/mpesa/c2b/register", ...guard, writeLimiter, c2bRegisterController);
router.post("/mpesa/c2b/simulate", ...guard, writeLimiter, c2bSimulateController);
router.get("/mpesa/statement", authenticate, requireBusinessAccess, requirePermission("payments.view"), c2bStatementController);
router.post("/pesapal/register-ipn", ...guard, writeLimiter, pesapalRegisterIpnController);
router.get("/pesapal/status", ...payGuard, pesapalTillStatusController);
router.get("/pesapal/attention", authenticate, requireBusinessAccess, requirePermission("payments.view"), pesapalAttentionController);
router.post("/pesapal/payment-requests", ...payGuard, payLimiter, pesapalCreateController);
router.get("/pesapal/payment-requests/:id", ...payGuard, pesapalGetController);

// Closing a payment is a money decision: owner / people explicitly given integrations.manage only.
router.post("/pesapal/payment-requests/:id/dismiss", ...guard, writeLimiter, pesapalDismissController);
router.post("/pesapal/payment-requests/:id/restore", ...guard, writeLimiter, pesapalRestoreController);

router.get("/", ...guard, listController);
router.get("/:provider", ...guard, getController);
router.put("/:provider", ...guard, writeLimiter, saveController);
router.post("/:provider/test", ...guard, testLimiter, testController);
router.post("/:provider/enable", ...guard, writeLimiter, enableController);
router.post("/:provider/disable", ...guard, writeLimiter, disableController);

export default router;
