import type { NextFunction, Request, Response } from "express";
import { registerUser } from "./register.service.js";
import { loadConfig } from "../lib/config.js";
import { issueSession } from "../lib/session-cookie.js";

export async function registerController(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const { name, email, password, businessName, businessType, inviteToken, invitePin } = req.body ?? {};

    if (!name || !email || !password || !businessName) {
      return res.status(400).json({
        success: false,
        message: "Name, email, password, and business name are required",
      });
    }

    const result = await registerUser({
      name,
      email,
      password,
      businessName,
      ...(businessType !== undefined && { businessType }),
      invite: { token: inviteToken, pin: invitePin },
      openRegistration: loadConfig().openRegistration,
    });

    return res.status(201).json({
      success: true,
      message: "Registration successful",
      data: issueSession(req, res, result),
    });
  } catch (error) {
    return next(error);
  }
}
