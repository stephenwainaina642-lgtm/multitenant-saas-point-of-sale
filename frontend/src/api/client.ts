import { forgetOfflineUser } from "../offlineSigninStore";

// Production builds call "/api" on the site's own address (Vercel forwards it to the backend, see vercel.json),
// so the session cookie is first-party. VITE_API_URL only applies to local development.
export const API_BASE_URL = import.meta.env.PROD
  ? "/api"
  : import.meta.env.VITE_API_URL || "http://localhost:5000/api";

/** Stored in place of a token: the real session is an httpOnly cookie. */
export const SESSION_MARKER = "cookie";

type ApiResponse<T> = {
  success: boolean;
  message: string;
  data?: T;
};

/** A failed request; `data` carries the server's detail (e.g. import row errors) when it sent any. */
export class ApiError extends Error {
  status: number;
  data?: unknown;
  constructor(message: string, status: number, data?: unknown) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export async function apiRequest<T>(
  path: string,
  options: {
    method?: "GET" | "POST" | "PUT" | "DELETE";
    token?: string;
    businessId?: string;
    body?: unknown;
    idempotencyKey?: string;
    /** Overrides the branch this device is working in (a queued sale must go to the branch it was rung up in). */
    branchId?: string;
  } = {}
): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  // The session itself lives in an httpOnly cookie the browser sends on its own. "cookie" is only a marker
  // saying "signed in"; a real token is never kept in page-readable storage.
  if (options.token && options.token !== SESSION_MARKER) {
    headers.Authorization = `Bearer ${options.token}`;
  }
  // Tells the server this call comes from the app itself (the cookie-based CSRF guard requires it).
  headers["X-Requested-With"] = "nexapos";

  // Who this tab believes is signed in. The sign-in cookie is shared by every tab of the browser, so if someone else
  // signs in elsewhere the server sees the mismatch and refuses, instead of this tab acting as the wrong person.
  try {
    const who = sessionStorage.getItem("pos_user_id");
    if (who) headers["X-Session-User"] = who;
  } catch {
    /* storage unavailable */
  }

  if (options.businessId) {
    headers["X-Business-ID"] = options.businessId;
  }

  // Which branch this device is working in (chosen in the sidebar; the server checks it is allowed).
  try {
    const branch = options.branchId ?? (options.businessId ? sessionStorage.getItem(`pos_branch_${options.businessId}`) : null);
    if (branch) headers["X-Branch-ID"] = branch;
  } catch {
    /* storage unavailable: the server falls back to the main branch */
  }

  if (options.idempotencyKey) {
    headers["Idempotency-Key"] = options.idempotencyKey;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? "GET",
    credentials: "include",
    headers,
    body:
      options.body === undefined
        ? undefined
        : JSON.stringify(options.body),
  });

  const result = (await response.json()) as ApiResponse<T>;

  // A rejected token (expired, or signed out by a password change) means this device must sign in again.
  if (response.status === 401 && options.token) {
    try {
      const wasPinSession = sessionStorage.getItem("pos_offline_session") === "1";
      // A closed or deleted account must not keep a PIN that opens the till on this PC.
      if (/inactive or does not exist/i.test(result.message ?? "")) forgetOfflineUser(sessionStorage.getItem("pos_user_id"));
      sessionStorage.clear();
      // Say why, on the sign-in screen that follows.
      if (/someone else signed in/i.test(result.message ?? "")) sessionStorage.setItem("pos_signin_notice", result.message);
      else if (wasPinSession) sessionStorage.setItem("pos_signin_notice", "You are back online. Sign in with your password so the sales made offline can be sent.");
    } catch {
      /* storage unavailable */
    }
    window.location.reload();
  }

  // The server accepted this session, so a PIN session is now a normal one.
  if (response.ok && options.token) {
    try { sessionStorage.removeItem("pos_offline_session"); } catch { /* storage unavailable */ }
  }

  if (!response.ok || !result.success) {
    throw new ApiError(result.message || `Request failed (${response.status})`, response.status, result.data);
  }

  return result;
}
