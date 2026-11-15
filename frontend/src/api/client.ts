const API_BASE_URL =
  import.meta.env.VITE_API_URL || "http://localhost:5000/api";

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

  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  if (options.businessId) {
    headers["X-Business-ID"] = options.businessId;
  }

  if (options.idempotencyKey) {
    headers["Idempotency-Key"] = options.idempotencyKey;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    body:
      options.body === undefined
        ? undefined
        : JSON.stringify(options.body),
  });

  const result = (await response.json()) as ApiResponse<T>;

  if (!response.ok || !result.success) {
    throw new ApiError(result.message || `Request failed (${response.status})`, response.status, result.data);
  }

  return result;
}
