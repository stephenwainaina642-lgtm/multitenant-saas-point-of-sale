import { loadTestConfig } from "./env.js";

const cfg = loadTestConfig();

export type ApiResult<T = any> = {
  status: number;
  body: { success?: boolean; message?: string; data?: T } & Record<string, any>;
};

export type Session = { token: string; businessId: string };

export async function api<T = any>(
  method: string,
  path: string,
  opts: { session?: Partial<Session>; body?: unknown } = {}
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.session?.token) headers.authorization = `Bearer ${opts.session.token}`;
  if (opts.session?.businessId) headers["x-business-id"] = opts.session.businessId;

  const res = await fetch(`${cfg.apiBase}${path}`, {
    method,
    headers,
    ...(opts.body !== undefined && { body: JSON.stringify(opts.body) }),
  });
  let body: any = {};
  try {
    body = await res.json();
  } catch {
    /* non-JSON */
  }
  return { status: res.status, body };
}

export const get = <T = any>(path: string, session?: Partial<Session>) =>
  api<T>("GET", path, session ? { session } : {});
export const post = <T = any>(path: string, session: Partial<Session> | undefined, body: unknown) =>
  api<T>("POST", path, { ...(session && { session }), body });
export const put = <T = any>(path: string, session: Partial<Session>, body: unknown) =>
  api<T>("PUT", path, { session, body });
export const del = <T = any>(path: string, session: Partial<Session>) =>
  api<T>("DELETE", path, { session });
