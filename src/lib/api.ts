import { getSession } from "@/lib/auth";

export interface ApiError extends Error { status: number; data: any }

/** fetch() against our own API routes with the signed-in user's token. Throws ApiError with the server's message. */
export async function authFetch<T = any>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const session = await getSession();
  const res = await fetch(path, {
    method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
    headers: { "Content-Type": "application/json", ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data?.error ?? `Request failed (${res.status})`) as ApiError;
    e.status = res.status; e.data = data;
    throw e;
  }
  return data as T;
}
