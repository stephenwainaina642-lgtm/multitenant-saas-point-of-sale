import { rateLimit } from "express-rate-limit";
import type { AppConfig } from "../lib/config.js";

function limiter(max: number, windowMs: number, message: string) {
  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({ success: false, message });
    },
  });
}

/** Slows password guessing: failed AND successful attempts count. */
export const loginLimiter = (config: Pick<AppConfig, "loginRateLimitMax">) =>
  limiter(
    config.loginRateLimitMax,
    15 * 60 * 1000,
    "Too many login attempts. Please wait a few minutes and try again."
  );

export const registerLimiter = (config: Pick<AppConfig, "registerRateLimitMax">) =>
  limiter(
    config.registerRateLimitMax,
    60 * 60 * 1000,
    "Too many registrations from this network. Please try again later."
  );
