import type { NextFunction, Response } from "express";
import type { BusinessRequest } from "./business.middleware.js";

/** Every permission the platform knows about. */
export const PERMISSION_CATALOG = {
  "products.view": "View products",
  "products.manage": "Create, edit and archive products",
  "inventory.view": "View stock movements",
  "inventory.adjust": "Adjust stock",
  "customers.view": "View customers",
  "customers.manage": "Create, edit and archive customers",
  "suppliers.view": "View suppliers",
  "suppliers.manage": "Create, edit and archive suppliers",
  "purchases.view": "View purchases",
  "purchases.create": "Record purchases and receive stock",
  "sales.create": "Make sales at the till",
  "sales.view_own": "View own sales",
  "sales.view_all": "View every sale in the business",
  "sales.edit": "Edit completed sales",
  "sales.void": "Void sales and issue refunds",
  "payments.view": "View all payments",
  "payments.create": "Record payments against sales",
  "expenses.view": "View expenses",
  "expenses.manage": "Record and edit expenses",
  "invoices.view": "View invoices",
  "invoices.manage": "Create invoices",
  "quotations.view": "View quotations",
  "quotations.manage": "Create quotations",
  "reports.view": "View business reports",
  "audit.view": "View the audit log",
  "roles.manage": "Create and edit roles",
  "employees.manage": "Add, deactivate and change employees",
  "settings.manage": "Change business settings",
} as const;

export type Permission = keyof typeof PERMISSION_CATALOG;
export const ALL_PERMISSIONS = Object.keys(PERMISSION_CATALOG) as Permission[];

/**
 * Defaults for the built-in role names (matched case-insensitively). A role
 * row with its own non-empty permission list overrides these.
 */
export const BUILT_IN_ROLES: Record<string, Permission[]> = {
  owner: ALL_PERMISSIONS,
  manager: ALL_PERMISSIONS.filter(
    (p) => p !== "roles.manage" && p !== "settings.manage" && p !== "employees.manage"
  ),
  "inventory manager": [
    "products.view", "products.manage", "inventory.view", "inventory.adjust",
    "suppliers.view", "suppliers.manage", "purchases.view", "purchases.create",
  ],
  salesperson: [
    "products.view", "customers.view", "customers.manage",
    "sales.create", "sales.view_own", "payments.create",
  ],
  cashier: [
    "products.view", "customers.view",
    "sales.create", "sales.view_own", "payments.create",
  ],
  accountant: [
    "sales.view_all", "payments.view", "expenses.view", "expenses.manage",
    "purchases.view", "invoices.view", "quotations.view", "reports.view",
  ],
};

export function resolvePermissions(
  roleName: string,
  stored: string[],
  isOwner: boolean
): Set<string> {
  const name = roleName.trim().toLowerCase();

  if (isOwner || name === "owner") {
    return new Set(ALL_PERMISSIONS);
  }

  const known = stored.filter((p) => p in PERMISSION_CATALOG);
  if (known.length > 0) {
    return new Set(known);
  }

  return new Set(BUILT_IN_ROLES[name] ?? []);
}

/** Allow the request only if the member holds at least one listed permission. */
export function requirePermission(...allowed: Permission[]) {
  return (req: BusinessRequest, res: Response, next: NextFunction) => {
    const held = req.permissions;

    if (!held || !allowed.some((p) => held.has(p))) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to perform this action",
      });
    }

    next();
  };
}
