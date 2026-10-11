import type { Request, Response } from "express";
import { loginUser } from "./auth.service.js";

export async function loginController(
  req: Request,
  res: Response
) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
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
    const message =
      error instanceof Error ? error.message : "Login failed";

    return res.status(401).json({
      success: false,
      message,
    });
  }
}