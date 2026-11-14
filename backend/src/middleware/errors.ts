import type { ErrorRequestHandler, RequestHandler } from "express";
import { AppError } from "../lib/errors.js";

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ success: false, message: "Route not found" });
};

/**
 * Last line of defence. Known errors keep their message; everything else is
 * logged server-side and returned as a generic 500 with no internals.
 */
export const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }

  if (error instanceof AppError) {
    return res.status(error.status).json({ success: false, message: error.message });
  }

  // express.json() failures
  const status = (error as { status?: number; type?: string })?.status;
  const type = (error as { type?: string })?.type;
  if (type === "entity.parse.failed") {
    return res.status(400).json({ success: false, message: "Request body is not valid JSON" });
  }
  if (type === "entity.too.large" || status === 413) {
    return res.status(413).json({ success: false, message: "Request body is too large" });
  }

  console.error("Unhandled error:", error);
  return res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
};
