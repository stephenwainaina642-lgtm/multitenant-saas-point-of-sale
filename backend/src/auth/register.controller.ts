import type { Request, Response } from "express";
import { registerUser } from "./register.service.js";

export async function registerController(
  req: Request,
  res: Response
) {
  try {
    const {
      name,
      email,
      password,
      businessName,
      businessType,
    } = req.body;

    if (!name || !email || !password || !businessName) {
      return res.status(400).json({
        success: false,
        message:
          "Name, email, password, and business name are required",
      });
    }

    const result = await registerUser({
      name,
      email,
      password,
      businessName,
      businessType,
    });

    return res.status(201).json({
      success: true,
      message: "Registration successful",
      data: result,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Registration failed";

    return res.status(400).json({
      success: false,
      message,
    });
  }
}
