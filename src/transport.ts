import { requireConfig } from "./config.js";
import type { CliDeps } from "./types.js";

export interface ApiPostOptions {
  headers?: Record<string, string>;
  endpoint?: "interface" | "chat";
}

const MAX_ERROR_TEXT_LENGTH = 240;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

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
  const baseUrl = options.endpoint === "chat" ? cfg.chatApiUrl : cfg.url;
  const endpoint = toEndpoint(baseUrl, pathname);

  const response = await deps.fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${cfg.token}`,
      ...(options.headers ?? {}),
    },
    body: JSON.stringify(body),
  });

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
