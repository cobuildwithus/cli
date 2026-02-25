import { requireConfig } from "./config.js";
import type { CliDeps } from "./types.js";

export interface ApiPostOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
}

const MAX_ERROR_TEXT_LENGTH = 240;
const DEFAULT_API_TIMEOUT_MS = 30_000;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const RESERVED_HEADER_NAMES = new Set(["authorization", "content-type"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseAndValidateBaseUrl(baseUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error("API base URL is invalid. Use an absolute https URL.");
  }

  if (parsed.username || parsed.password) {
    throw new Error("API base URL must not include username or password.");
  }

  if (parsed.protocol === "https:") {
    return parsed;
  }

  if (parsed.protocol === "http:" && LOOPBACK_HOSTS.has(parsed.hostname)) {
    return parsed;
  }

  throw new Error("API base URL must use https (http is allowed only for localhost, 127.0.0.1, or [::1]).");
}

function normalizeTimeoutMs(timeoutMs: number | undefined): number {
  const candidate = timeoutMs ?? DEFAULT_API_TIMEOUT_MS;
  if (!Number.isFinite(candidate) || candidate <= 0) {
    throw new Error("Request timeout must be a positive number of milliseconds.");
  }
  return Math.floor(candidate);
}

function validateCustomHeaders(headers: Record<string, string> | undefined): void {
  if (!headers) return;
  for (const name of Object.keys(headers)) {
    if (RESERVED_HEADER_NAMES.has(name.toLowerCase())) {
      throw new Error(`Custom headers must not override reserved header: ${name}`);
    }
  }
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { name?: unknown; code?: unknown };
  return value.name === "AbortError" || value.code === "ABORT_ERR";
}

function sanitizeErrorText(raw: string): string {
  const withoutControlChars = raw.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ");
  const normalized = withoutControlChars.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  if (normalized.length <= MAX_ERROR_TEXT_LENGTH) {
    return normalized;
  }
  return `${normalized.slice(0, MAX_ERROR_TEXT_LENGTH - 3)}...`;
}

function formatRequestError(status: number, rawDetail: string | null): string {
  const detail = rawDetail ? sanitizeErrorText(rawDetail) : "";
  const prefix = `Request failed (status ${status})`;
  return detail ? `${prefix}: ${detail}` : prefix;
}

export function toEndpoint(baseUrl: string, pathname: string): URL {
  const validatedBase = parseAndValidateBaseUrl(baseUrl);
  const normalizedBase = validatedBase.href.endsWith("/")
    ? validatedBase.href
    : `${validatedBase.href}/`;
  const normalizedPath = pathname.startsWith("/") ? pathname.slice(1) : pathname;
  return new URL(normalizedPath, normalizedBase);
}

export async function apiPost(
  deps: Pick<CliDeps, "fetch" | "fs" | "homedir">,
  pathname: string,
  body: Record<string, unknown>,
  options: ApiPostOptions = {}
): Promise<unknown> {
  const cfg = requireConfig(deps);
  const endpoint = toEndpoint(cfg.url, pathname);
  const timeoutMs = normalizeTimeoutMs(options.timeoutMs);
  validateCustomHeaders(options.headers);

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  timeout.unref?.();

  let response;
  try {
    response = await deps.fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${cfg.token}`,
        ...(options.headers ?? {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const text = await response.text();
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = { ok: false, error: text };
  }

  if (!response.ok || (isRecord(payload) && payload.ok === false)) {
    const rawDetail = isRecord(payload) && typeof payload.error === "string" ? payload.error : null;
    const errorMessage = formatRequestError(response.status, rawDetail);
    throw new Error(errorMessage);
  }

  return payload;
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (isRecord(value)) {
    return value;
  }
  return { result: value };
}
