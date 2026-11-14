import type { NextFunction, Request, Response } from "express";
import { loginUser } from "./auth.service.js";

export async function loginController(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const { email, password } = req.body ?? {};

    if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    const result = await loginUser(email, password);

    return res.status(200).json({
      success: true,
      message: "Login successful",
      data: result,
    });
  } catch (error) {
    // AppError keeps its status (401); anything else becomes a generic 500.
    return next(error);
  }
}
