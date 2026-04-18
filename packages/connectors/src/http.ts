import { BreezeError, type BreezeErrorCode } from "@breeze/common";

declare const process: { env: Record<string, string | undefined> };

export function env(name: string): string | undefined {
  return process.env[name];
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new BreezeError("auth", `Missing env: ${name}`);
  return v;
}

export interface HttpRequest {
  url: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  bearer?: string;
  signal?: AbortSignal;
}

function statusToCode(status: number): BreezeErrorCode {
  if (status === 401) return "auth";
  if (status === 403) return "permission";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 422) return "validation";
  if (status === 429) return "rate_limit";
  if (status >= 500) return "upstream";
  return "unknown";
}

export function appendQuery(url: string, query?: HttpRequest["query"]): string {
  if (!query) return url;
  const u = new URL(url);
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined) continue;
    u.searchParams.set(k, String(v));
  }
  return u.toString();
}

export async function httpJson<T = unknown>(req: HttpRequest): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json", ...(req.headers ?? {}) };
  if (req.bearer) headers.Authorization = `Bearer ${req.bearer}`;
  if (req.body !== undefined && !headers["Content-Type"]) headers["Content-Type"] = "application/json";

  const res = await fetch(appendQuery(req.url, req.query), {
    method: req.method ?? "GET",
    headers,
    body: req.body === undefined ? undefined : typeof req.body === "string" ? req.body : JSON.stringify(req.body),
    signal: req.signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new BreezeError(statusToCode(res.status), `${req.method ?? "GET"} ${req.url} failed: ${res.status} ${text.slice(0, 500)}`, {
      retryable: res.status === 429 || res.status >= 500,
      details: { status: res.status },
    });
  }

  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return (await res.json()) as T;
  return (await res.text()) as unknown as T;
}
