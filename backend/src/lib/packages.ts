import type { NextFunction, Response } from "express";

/**
 * Packaging. A business has a package (the starting point) and an explicit list of optional modules.
 * The package only decides the defaults; what a business can actually use is its module list, which the platform
 * team can adjust per client. Core features (sales, products, stock, customers, expenses, reports, settings) are
 * always on and are not modules.
 */
export const PACKAGES = ["retail", "hotel"] as const;
export type PackageName = (typeof PACKAGES)[number];

export const MODULES = ["tables", "rooms", "purchasing", "documents"] as const;
export type ModuleName = (typeof MODULES)[number];

export const MODULE_INFO: Record<ModuleName, { label: string; covers: string }> = {
  tables: { label: "Tables & Orders", covers: "Tables, orders, kitchen tickets, split bills, menu extras, recipes and costing" },
  rooms: { label: "Rooms", covers: "Guest check-in, charge to room, folios, deposits and check-out" },
  purchasing: { label: "Purchasing", covers: "Suppliers and purchases" },
  documents: { label: "Quotations & Invoices", covers: "Customer quotations and invoices" },
};

export const PACKAGE_INFO: Record<PackageName, { label: string; modules: ModuleName[] }> = {
  retail: { label: "Retail shop", modules: ["purchasing", "documents"] },
  hotel: { label: "Hotel", modules: ["tables", "rooms", "purchasing", "documents"] },
};

export const isPackage = (v: unknown): v is PackageName => typeof v === "string" && (PACKAGES as readonly string[]).includes(v);
export const isModule = (v: unknown): v is ModuleName => typeof v === "string" && (MODULES as readonly string[]).includes(v);

/** What a new business starts with, by its type. Restaurants get the hotel package without Rooms. */
export function defaultsForType(businessType: string, requested?: PackageName | null): { package: PackageName; modules: ModuleName[] } {
  const pkg: PackageName = requested ?? (businessType === "hotel" || businessType === "restaurant" ? "hotel" : "retail");
  const modules = [...PACKAGE_INFO[pkg].modules];
  return { package: pkg, modules: !requested && businessType === "restaurant" ? modules.filter((m) => m !== "rooms") : modules };
}

/** Which module a request needs, from the router it reached (null = core, always allowed). */
export function moduleForRequest(baseUrl: string, path: string): ModuleName | null {
  if (baseUrl === "/api/purchases" || baseUrl === "/api/suppliers") return "purchasing";
  if (baseUrl === "/api/quotations" || baseUrl === "/api/invoices") return "documents";
  if (baseUrl === "/api/hotel") return path === "/stays" || path.startsWith("/stays/") ? "rooms" : "tables";
  return null;
}

/** Charging a bill to a room is a table feature too: it needs Tables & Orders and Rooms. */
export function moduleError(res: Response, label: string) {
  return res.status(403).json({ success: false, message: `${label} is not included in this business's package. Contact support to add it.` });
}
export type { NextFunction };
