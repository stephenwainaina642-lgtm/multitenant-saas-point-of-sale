import { Router } from "express";
import type { NextFunction, Response } from "express";
import { authenticate } from "../auth/auth.middleware.js";
import { requireBusinessAccess } from "../auth/business.middleware.js";
import type { BusinessRequest } from "../auth/business.middleware.js";
import { requirePermission } from "../auth/permissions.js";
import { AppError } from "../lib/errors.js";
import { importCustomers, importProducts } from "./import.service.js";

const router = Router();

const run =
  (fn: typeof importProducts) =>
  async (req: BusinessRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.businessId) throw new AppError(400, "Business context is required");
      const { rows, dryRun } = req.body ?? {};
      const result = await fn(req.businessId, BigInt(req.user!.userId), rows, dryRun === true, req.branchId);
      const failed = result.errors.length > 0;
      res.status(failed ? 422 : result.dryRun ? 200 : 201).json({
        success: !failed,
        message: failed
          ? `Nothing was imported: ${result.errors.length} problem(s) found. Fix them and send the file again.`
          : result.dryRun ? "All rows are valid" : `${result.created} imported`,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

router.post("/products", authenticate, requireBusinessAccess, requirePermission("products.manage"), run(importProducts));
router.post("/customers", authenticate, requireBusinessAccess, requirePermission("customers.manage"), run(importCustomers));

export default router;
