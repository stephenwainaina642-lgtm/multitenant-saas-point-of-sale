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
  "purchases.pay": "Record payments to suppliers",
  "purchases.void": "Void purchases",
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
  "shifts.use": "Open and close own till shift (cash-up)",
  "shifts.view_all": "View every cashier's shifts and add manager notes",
  "branches.manage": "Create and edit branches and assign staff to them",
  "branches.all": "Work in and see every branch (others stay in their assigned branch)",
  "stock.transfer": "Move stock between branches",
} as const;

export type Permission = keyof typeof PERMISSION_CATALOG;
export const ALL_PERMISSIONS = Object.keys(PERMISSION_CATALOG) as Permission[];

/**
 * Starter templates. They are copied into every business as ordinary, editable
 * roles when it is created; nothing here is consulted when checking access.
 * Only the Owner is hardcoded (see resolvePermissions).
 */
export const BUILT_IN_ROLES: Record<string, Permission[]> = {
  owner: ALL_PERMISSIONS,
  manager: ALL_PERMISSIONS.filter(
    (p) => p !== "roles.manage" && p !== "settings.manage" && p !== "employees.manage"
  ),
  "inventory manager": [
    "products.view", "products.manage", "inventory.view", "inventory.adjust",
    "suppliers.view", "suppliers.manage", "purchases.view", "purchases.create", "stock.transfer",
  ],
  salesperson: [
    "products.view", "customers.view", "customers.manage",
    "sales.create", "sales.view_own", "payments.create", "shifts.use",
  ],
  cashier: [
    "products.view", "customers.view",
    "sales.create", "sales.view_own", "payments.create", "shifts.use",
  ],
  accountant: [
    "sales.view_all", "payments.view", "expenses.view", "expenses.manage",
    "purchases.view", "purchases.pay", "invoices.view", "quotations.view", "reports.view", "shifts.view_all", "branches.all",
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

  // Everyone else gets exactly what their role row lists, no more.
  return new Set(stored.filter((p) => p in PERMISSION_CATALOG));
}

/** Rows to create for a new business: the starter roles, with their permissions written out. */
export function starterRoleRows(businessId: bigint) {
  return Object.entries(BUILT_IN_ROLES)
    .filter(([name]) => name !== "owner")
    .map(([name, permissions]) => ({
      businessId,
      name: name.replace(/\b\w/g, (c) => c.toUpperCase()),
      description: "Starter role (editable)",
      permissions: [...permissions],
    }));
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

export type GrantActor = { permissions?: ReadonlySet<string> | undefined; isOwner?: boolean | undefined };

/**
 * Privilege-escalation guard: only the owner may hand out anything. Anyone else can
 * grant only permissions they hold themselves.
 */
export function missingForGrant(actor: GrantActor, wanted: readonly string[]): string[] {
  if (actor.isOwner) return [];
  const held = actor.permissions ?? new Set<string>();
  return wanted.filter((p) => !held.has(p));
}
