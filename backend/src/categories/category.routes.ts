import { Router, type Response } from "express";
import { authenticate } from "../auth/auth.middleware.js";
import { requireBusinessAccess, type BusinessRequest } from "../auth/business.middleware.js";
import { requirePermission } from "../auth/permissions.js";
import { AppError } from "../lib/errors.js";
import { createCategory, deleteCategory, listCategories, updateCategory } from "./category.service.js";

const router = Router();
const uid = (req: BusinessRequest) => (req.user ? String(req.user.userId) : undefined);
const bid = (req: BusinessRequest) => req.businessId!.toString();
const idOf = (req: BusinessRequest) => String(req.params.id);

function fail(res: Response, error: unknown) {
  if (error instanceof AppError) return res.status(error.status).json({ success: false, message: error.message });
  console.error("Category error:", error);
  return res.status(500).json({ success: false, message: "Category request failed" });
}

const auth = [authenticate, requireBusinessAccess];

router.get("/", ...auth, requirePermission("products.view"), async (req: BusinessRequest, res) => {
  try { res.json({ success: true, data: await listCategories(bid(req)) }); } catch (e) { fail(res, e); }
});
router.post("/", ...auth, requirePermission("products.manage"), async (req: BusinessRequest, res) => {
  try { res.status(201).json({ success: true, message: "Category created", data: await createCategory(bid(req), req.body ?? {}, uid(req)) }); } catch (e) { fail(res, e); }
});
router.put("/:id", ...auth, requirePermission("products.manage"), async (req: BusinessRequest, res) => {
  try { res.json({ success: true, message: "Category updated", data: await updateCategory(bid(req), idOf(req), req.body ?? {}, uid(req)) }); } catch (e) { fail(res, e); }
});
router.delete("/:id", ...auth, requirePermission("products.manage"), async (req: BusinessRequest, res) => {
  try { res.json({ success: true, message: "Category deleted", data: await deleteCategory(bid(req), idOf(req), uid(req)) }); } catch (e) { fail(res, e); }
});

export default router;
