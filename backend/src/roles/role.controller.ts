import type { Response } from "express";
import type { BusinessRequest } from "../auth/business.middleware.js";
import { AppError } from "../lib/errors.js";
import {
  createBusinessRole,
  deleteBusinessRole,
  getBusinessRoles,
  getPermissionCatalog,
  updateBusinessRole,
} from "./role.service.js";

function fail(res: Response, error: unknown, label: string) {
  if (error instanceof AppError) {
    return res.status(error.status).json({ success: false, message: error.message });
  }

  console.error(`${label}:`, error);
  return res.status(500).json({ success: false, message: "Something went wrong" });
}

export async function getPermissionCatalogController(
  _req: BusinessRequest,
  res: Response
) {
  return res.json({ success: true, data: getPermissionCatalog() });
}

export async function getRolesController(req: BusinessRequest, res: Response) {
  try {
    const roles = await getBusinessRoles(req.businessId!.toString());
    return res.json({ success: true, data: roles });
  } catch (error) {
    return fail(res, error, "Get roles error");
  }
}

export async function createRoleController(req: BusinessRequest, res: Response) {
  try {
    const role = await createBusinessRole(req.businessId!.toString(), req.body ?? {});
    return res.status(201).json({ success: true, message: "Role created", data: role });
  } catch (error) {
    return fail(res, error, "Create role error");
  }
}

export async function updateRoleController(req: BusinessRequest, res: Response) {
  try {
    const role = await updateBusinessRole(
      req.businessId!.toString(),
      String(req.params.id),
      req.body ?? {}
    );
    return res.json({ success: true, message: "Role updated", data: role });
  } catch (error) {
    return fail(res, error, "Update role error");
  }
}

export async function deleteRoleController(req: BusinessRequest, res: Response) {
  try {
    await deleteBusinessRole(req.businessId!.toString(), String(req.params.id));
    return res.json({ success: true, message: "Role deleted" });
  } catch (error) {
    return fail(res, error, "Delete role error");
  }
}
