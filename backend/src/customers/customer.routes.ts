import { Router } from "express";
import { authenticate } from "../auth/auth.middleware.js";
import { requireBusinessAccess } from "../auth/business.middleware.js";
import type { BusinessRequest } from "../auth/business.middleware.js";
import { requirePermission } from "../auth/permissions.js";
import {
  getCustomersController,
  createCustomerController,
  updateCustomerController,
  deleteCustomerController,
} from "./customer.controller.js";
import { customerUnpaidSales, receiveCustomerPayment } from "./customer-payment.service.js";

const router = Router();

router.get(
  "/",
  authenticate,
  requireBusinessAccess,
  requirePermission("customers.view"),
  getCustomersController
);

router.post(
  "/",
  authenticate,
  requireBusinessAccess,
  requirePermission("customers.manage"),
  createCustomerController
);

router.put(
  "/:id",
  authenticate,
  requireBusinessAccess,
  requirePermission("customers.manage"),
  updateCustomerController
);

router.delete(
  "/:id",
  authenticate,
  requireBusinessAccess,
  requirePermission("customers.manage"),
  deleteCustomerController
);

const actorOf = (req: BusinessRequest) => ({ userId: req.user!.userId, onlyOwnSales: !req.permissions?.has("sales.view_all") });

router.get("/:id/unpaid-sales", authenticate, requireBusinessAccess, requirePermission("customers.view"), (req: BusinessRequest, res, next) => {
  customerUnpaidSales(req.businessId!.toString(), String(req.params.id), actorOf(req))
    .then((data) => res.json({ success: true, data }))
    .catch(next);
});

router.post("/:id/payments", authenticate, requireBusinessAccess, requirePermission("payments.create"), (req: BusinessRequest, res, next) => {
  const header = req.headers["idempotency-key"];
  receiveCustomerPayment(req.businessId!.toString(), String(req.params.id), actorOf(req), req.body ?? {}, Array.isArray(header) ? undefined : header)
    .then((data) => res.status(201).json({ success: true, message: "Payment recorded", data }))
    .catch(next);
});

export default router;
