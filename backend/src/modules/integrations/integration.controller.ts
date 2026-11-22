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
