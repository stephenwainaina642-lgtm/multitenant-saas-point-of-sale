import { Router, type NextFunction, type Response } from "express";
import { authenticate } from "../auth/auth.middleware.js";
import { requireBusinessAccess, type BusinessRequest } from "../auth/business.middleware.js";
import { requirePermission } from "../auth/permissions.js";
import * as hotel from "./hotel.service.js";

/**
 * Tables and open orders for hotels and restaurants. Taking orders and billing use the till permission (sales.create);
 * adding or removing tables needs products.manage. Billing goes through the normal sale code.
 */
const router = Router();
router.use(authenticate, requireBusinessAccess);

type Handler = (req: BusinessRequest) => Promise<unknown>;
const wrap = (fn: Handler, status = 200) => async (req: BusinessRequest, res: Response, next: NextFunction) => {
  try { res.status(status).json({ success: true, data: await fn(req) }); } catch (e) { next(e); }
};
const id = (req: BusinessRequest, name = "id") => String(req.params[name]);

router.get("/menu", requirePermission("sales.create"), wrap((r) => hotel.menu(r.businessId!)));
router.get("/settings", requirePermission("sales.create"), wrap((r) => hotel.getSettings(r.businessId!)));
router.put("/settings", requirePermission("settings.manage"), wrap((r) => hotel.updateSettings(r.businessId!, r.body ?? {})));
router.get("/addons", requirePermission("sales.create"), wrap((r) => hotel.listAddons(r.businessId!)));
router.post("/addons", requirePermission("products.manage"), wrap((r) => hotel.createAddon(r.businessId!, r.body ?? {}), 201));
router.delete("/addons/:id", requirePermission("products.manage"), wrap(async (r) => { await hotel.deleteAddon(r.businessId!, id(r)); return null; }));
router.get("/tables", requirePermission("sales.create"), wrap((r) => hotel.listTables(r.businessId!, r.branchId!)));
router.post("/tables", requirePermission("products.manage"), wrap((r) => hotel.createTable(r.businessId!, r.branchId!, r.body ?? {}), 201));
router.delete("/tables/:id", requirePermission("products.manage"), wrap(async (r) => { await hotel.deleteTable(r.businessId!, id(r)); return null; }));

router.post("/tables/:id/orders", requirePermission("sales.create"), wrap((r) => hotel.openOrder(r.businessId!, r.branchId!, BigInt(r.user!.userId), id(r), r.body ?? {}), 201));
router.get("/orders/:id", requirePermission("sales.create"), wrap((r) => hotel.getOrder(r.businessId!, id(r))));
router.post("/orders/:id/items", requirePermission("sales.create"), wrap((r) => hotel.addItem(r.businessId!, id(r), r.body ?? {}), 201));
router.put("/orders/:id/items/:itemId", requirePermission("sales.create"), wrap((r) => hotel.setItemQuantity(r.businessId!, id(r), id(r, "itemId"), r.body ?? {})));
router.delete("/orders/:id/items/:itemId", requirePermission("sales.create"), wrap((r) => hotel.removeItem(r.businessId!, id(r), id(r, "itemId"), r.body ?? {})));
router.post("/orders/:id/send", requirePermission("sales.create"), wrap((r) => hotel.sendToKitchen(r.businessId!, id(r))));
router.post("/orders/:id/cancel", requirePermission("sales.create"), wrap((r) => hotel.cancelOrder(r.businessId!, id(r), r.body ?? {})));
router.post("/orders/:id/bill", requirePermission("sales.create"), wrap((r) => hotel.billOrder(r.businessId!, BigInt(r.user!.userId), id(r), r.body ?? {})));

export default router;
