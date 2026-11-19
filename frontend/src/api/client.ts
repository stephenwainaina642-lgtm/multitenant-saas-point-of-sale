// Production builds call "/api" on the site's own address (Vercel forwards it to the backend, see vercel.json),
// so the session cookie is first-party. VITE_API_URL only applies to local development.
const API_BASE_URL = import.meta.env.PROD
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

  if (options.businessId) {
    headers["X-Business-ID"] = options.businessId;
  }

  // Which branch this device is working in (chosen in the sidebar; the server checks it is allowed).
  try {
    const branch = options.businessId ? sessionStorage.getItem(`pos_branch_${options.businessId}`) : null;
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
      sessionStorage.clear();
    } catch {
      /* storage unavailable */
    }
    window.location.reload();
  }

  if (!response.ok || !result.success) {
    throw new ApiError(result.message || `Request failed (${response.status})`, response.status, result.data);
  }

  return result;
}
