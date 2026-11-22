import type { NextFunction, Response } from "express";
import type { BusinessRequest } from "../../auth/business.middleware.js";
import { AppError } from "../../lib/errors.js";
import { isProviderId, type ProviderId } from "./providers/index.js";
import { getIntegration, listIntegrations, saveIntegration, setIntegrationEnabled, testIntegration } from "./integration.service.js";
import { parseIdempotencyKey } from "./validation.js";

type Handler = (req: BusinessRequest, res: Response) => Promise<void>;
const wrap = (fn: Handler) => (req: BusinessRequest, res: Response, next: NextFunction) => {
  fn(req, res).catch((e) => {
    if (e instanceof AppError) {
      res.status(e.status).json({ success: false, message: e.message });
      return;
    }
    next(e);
  });
};

const actor = (req: BusinessRequest) => ({ businessId: req.businessId!, userId: BigInt(req.user!.userId), ip: req.ip });
const providerOf = (req: BusinessRequest): ProviderId => {
  const p = req.params.provider;
  if (!isProviderId(p)) throw new AppError(404, "Unknown integration");
  return p;
};

export const listController = wrap(async (req, res) => {
  res.json({ success: true, data: await listIntegrations(req.businessId!) });
});
export const getController = wrap(async (req, res) => {
  res.json({ success: true, data: await getIntegration(req.businessId!, providerOf(req)) });
});
export const saveController = wrap(async (req, res) => {
  res.json({ success: true, data: await saveIntegration(actor(req), providerOf(req), req.body) });
});
export const testController = wrap(async (req, res) => {
  const key = parseIdempotencyKey(req.header("idempotency-key"));
  const r = await testIntegration(actor(req), providerOf(req), key);
  res.json({ success: true, data: r });
});
export const enableController = wrap(async (req, res) => {
  res.json({ success: true, data: await setIntegrationEnabled(actor(req), providerOf(req), true, undefined) });
});
export const disableController = wrap(async (req, res) => {
  res.json({ success: true, data: await setIntegrationEnabled(actor(req), providerOf(req), false, req.body?.confirm) });
});

import { createPaymentRequest, getPaymentRequest, handleCallback } from "./mpesa-payments.service.js";

export const createPaymentController = wrap(async (req, res) => {
  const key = parseIdempotencyKey(req.header("idempotency-key"));
  if (!key) throw new AppError(400, "Send an Idempotency-Key header so a retry cannot ask the customer twice");
  const r = await createPaymentRequest(actor(req), req.body ?? {}, key);
  res.status(r.replayed ? 200 : 201).json({ success: true, data: r.request, replayed: r.replayed });
});
export const getPaymentController = wrap(async (req, res) => {
  res.json({ success: true, data: await getPaymentRequest(req.businessId!, String(req.params.id)) });
});

/** Public (Safaricom calls it). No session; the secret token in the path is the credential. */
export const mpesaCallbackController = (req: import("express").Request, res: Response, next: NextFunction) => {
  handleCallback(String(req.params.token), req.body)
    .then((found) => {
      if (!found) { res.status(404).json({ success: false, message: "Not found" }); return; }
      res.json({ ResultCode: 0, ResultDesc: "Accepted" });
    })
    .catch(next);
};
