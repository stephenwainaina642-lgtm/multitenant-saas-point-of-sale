import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

/**
 * Browser sessions live in an httpOnly cookie, so scripts running on the page (an injected script, a
 * hostile extension) cannot read the token. The token is NOT put in the response body unless the caller
 * asks for it with "X-Auth-Mode: bearer" (scripts, tests and other non-browser clients).
 */
export const SESSION_COOKIE = "nexa_session";
export const PLATFORM_COOKIE = "nexa_platform";
export const PLATFORM_COOKIE_PATH = "/api/platform";

const secure = () => process.env.NODE_ENV === "production";
// "lax" is right when the site and the API share one origin (the Vercel pass-through) or one registrable
// domain. "none" is only for a cross-site setup and is increasingly blocked by browsers.
const sameSite = (): "lax" | "strict" | "none" => {
  const v = (process.env.COOKIE_SAMESITE ?? "lax").toLowerCase();
  return v === "strict" || v === "none" ? v : "lax";
};

export function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0 || part.slice(0, i).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

export function setSessionCookie(res: Response, name: string, token: string, path = "/") {
  const exp = (jwt.decode(token) as { exp?: number } | null)?.exp;
  res.cookie(name, token, {
    httpOnly: true,
    secure: secure() || sameSite() === "none",
    sameSite: sameSite(),
    path,
    ...(exp && { maxAge: Math.max(0, exp * 1000 - Date.now()) }),
  });
}

export function clearSessionCookie(res: Response, name: string, path = "/") {
  res.clearCookie(name, { httpOnly: true, secure: secure() || sameSite() === "none", sameSite: sameSite(), path });
}

/** True when the caller asked to receive the token in the response body (non-browser clients). */
export const wantsBearer = (req: Request) => String(req.headers["x-auth-mode"] ?? "").toLowerCase() === "bearer";

/**
 * Sets the browser cookie and returns the response data with the token removed
 * (kept only for callers that ask for bearer mode).
 */
export function issueSession<T extends { token: string }>(req: Request, res: Response, data: T, name = SESSION_COOKIE, path = "/") {
  setSessionCookie(res, name, data.token, path);
  if (wantsBearer(req)) return data;
  const { token: _omitted, ...rest } = data;
  return rest;
}

/**
 * Cookie-authenticated requests that change something must come from this app: they need the custom
 * header (which another website cannot add without a CORS pre-flight we do not allow) and, when the
 * browser states an Origin, it must be one of ours. Requests that carry an Authorization header
 * are not cookie-based and are unaffected.
 */
export function csrfGuard(allowedOrigins: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    if (req.headers.authorization) return next();
    if (!readCookie(req, SESSION_COOKIE) && !readCookie(req, PLATFORM_COOKIE)) return next();
    const origin = req.headers.origin;
    const bad =
      req.headers["x-requested-with"] !== "nexapos" ||
      (typeof origin === "string" && origin !== "null" && allowedOrigins.length > 0 && !allowedOrigins.includes(origin)) ||
      origin === "null";
    if (bad) return res.status(403).json({ success: false, message: "Request blocked: it did not come from the nexaPOS app." });
    next();
  };
}
