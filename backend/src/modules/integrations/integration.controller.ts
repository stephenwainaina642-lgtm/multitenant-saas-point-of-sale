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

import { createPaymentRequest, getPaymentRequest, dismissRequest, handleCallback, listAttention, restoreRequest, mpesaStatusForTill } from "./mpesa-payments.service.js";

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
export const mpesaTillStatusController = wrap(async (req, res) => {
  res.json({ success: true, data: await mpesaStatusForTill(req.businessId!) });
});
export const mpesaAttentionController = wrap(async (req, res) => {
  res.json({ success: true, data: await listAttention(req.businessId!) });
});
export const mpesaDismissController = wrap(async (req, res) => {
  res.json({ success: true, data: await dismissRequest(actor(req), String(req.params.id), req.body?.note) });
});
export const mpesaRestoreController = wrap(async (req, res) => {
  res.json({ success: true, data: await restoreRequest(actor(req), String(req.params.id)) });
});

import { createPesapalRequest, getPesapalRequest, handlePesapalIpn, listPesapalAttention, pesapalStatusForTill, registerPesapalIpn } from "./pesapal-payments.service.js";

export const pesapalRegisterIpnController = wrap(async (req, res) => {
  res.json({ success: true, data: await registerPesapalIpn(actor(req)) });
});
export const pesapalCreateController = wrap(async (req, res) => {
  const key = parseIdempotencyKey(req.header("idempotency-key"));
  if (!key) throw new AppError(400, "Send an Idempotency-Key header so a retry cannot create two payment pages");
  const r = await createPesapalRequest(actor(req), req.body ?? {}, key);
  res.status(r.replayed ? 200 : 201).json({ success: true, data: r.request, replayed: r.replayed });
});
export const pesapalGetController = wrap(async (req, res) => {
  res.json({ success: true, data: await getPesapalRequest(req.businessId!, String(req.params.id)) });
});
export const pesapalTillStatusController = wrap(async (req, res) => {
  res.json({ success: true, data: await pesapalStatusForTill(req.businessId!) });
});
export const pesapalAttentionController = wrap(async (req, res) => {
  res.json({ success: true, data: await listPesapalAttention(req.businessId!) });
});

/** Public (Pesapal calls it). No session; the secret token in the path is the credential. */
export const pesapalIpnController = (req: import("express").Request, res: Response, next: NextFunction) => {
  handlePesapalIpn(String(req.params.connectionId), String(req.params.token), { ...(req.body && typeof req.body === "object" ? req.body : {}), ...req.query })
    .then((reply) => {
      if (!reply) { res.status(404).json({ success: false, message: "Not found" }); return; }
      res.json(reply);
    })
    .catch(next);
};

/** Where the customer lands after paying. A plain page: nothing in it comes from the request and it proves nothing. */
export const pesapalReturnController = (_req: import("express").Request, res: Response) => {
  res.status(200).type("html").send(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Payment submitted</title>` +
    `<body style="font-family:system-ui,sans-serif;max-width:28rem;margin:4rem auto;padding:0 1rem;text-align:center"><h1 style="font-size:1.4rem">Thank you</h1>` +
    `<p>Your payment is being confirmed. You can close this page; the shop will see the result shortly.</p></body></html>`
  );
};
