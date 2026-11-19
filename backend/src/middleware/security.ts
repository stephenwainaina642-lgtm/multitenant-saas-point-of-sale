import { ipKeyGenerator, rateLimit } from "express-rate-limit";
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

/**
 * Stops password guessing against ONE account no matter which network the guesses come from (the per-IP
 * limit cannot do this on its own behind proxies, and an attacker can rotate addresses). Only FAILED
 * sign-ins count, so a person who types the right password is never blocked by their own earlier success.
 * Trade-off: someone can deliberately fail on a victim's email and lock that person out for the window.
 */
export const accountLoginLimiter = (config: Pick<AppConfig, "accountLoginFailuresMax">) =>
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: config.accountLoginFailuresMax,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    keyGenerator: (req) => {
      const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase().slice(0, 254) : "";
      return email ? `acct:${email}` : ipKeyGenerator(req.ip ?? "");
    },
    handler: (_req, res) => {
      res.status(429).json({ success: false, message: "Too many failed sign-in attempts for this account. Please wait 15 minutes, or reset your password." });
    },
  });
