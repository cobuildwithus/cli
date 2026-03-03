import {
  persistRefreshToken,
  readConfig,
  requireConfig,
  writeConfig,
} from "./config.js";
import { OAuthTokenRequestError, refreshAccessToken } from "./oauth.js";
import type { CliDeps } from "./types.js";
import { parseAndValidateApiBaseUrl } from "./url.js";

export interface ApiRequestOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
}

const MAX_ERROR_TEXT_LENGTH = 240;
const DEFAULT_API_TIMEOUT_MS = 30_000;
const ACCESS_TOKEN_REFRESH_SKEW_MS = 30_000;
const RESERVED_HEADER_NAMES = new Set(["authorization", "content-type"]);
const DEFAULT_REQUEST_HEADERS = {
  "content-type": "application/json",
} as const;

type OAuthAccessTokenCacheEntry = {
  accessToken: string;
  refreshToken: string;
  expiresAtMs: number;
};

const oauthAccessTokenCache = new Map<string, OAuthAccessTokenCacheEntry>();
const oauthAccessTokenInflight = new Map<string, Promise<OAuthAccessTokenCacheEntry>>();

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class ApiRequestError extends Error {
  readonly status: number;
  readonly detail: string | null;
  readonly payload: unknown;

  constructor(status: number, detail: string | null, payload: unknown = null) {
    super(formatRequestError(status, detail));
    this.name = "ApiRequestError";
    this.status = status;
    this.detail = detail;
    this.payload = payload;
  }
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
  const validatedBase = parseAndValidateApiBaseUrl(baseUrl, "API base URL");
  const normalizedBase = validatedBase.href.endsWith("/")
    ? validatedBase.href
    : `${validatedBase.href}/`;
  const normalizedPath = pathname.startsWith("/") ? pathname.slice(1) : pathname;
  return new URL(normalizedPath, normalizedBase);
}

function resolveApiBaseUrl(pathname: string, config: { url: string; chatApiUrl: string }): string {
  if (pathname.startsWith("/v1/")) {
    return config.chatApiUrl;
  }
  return config.url;
}

function isRefreshToken(token: string): boolean {
  return token.startsWith("rfr_");
}

function oauthCacheKey(config: { url: string; chatApiUrl: string; agent?: string }): string {
  return `${config.url}::${config.chatApiUrl}::${config.agent ?? ""}`;
}

function shouldReuseAccessToken(entry: OAuthAccessTokenCacheEntry): boolean {
  return Date.now() + ACCESS_TOKEN_REFRESH_SKEW_MS < entry.expiresAtMs;
}

function persistRotatedRefreshToken(params: {
  deps: Pick<CliDeps, "fs" | "homedir">;
  interfaceUrl: string;
  nextRefreshToken: string;
}): void {
  const current = readConfig(params.deps);
  const next = persistRefreshToken({
    deps: params.deps,
    config: current,
    token: params.nextRefreshToken,
    interfaceUrl: params.interfaceUrl,
  });
  writeConfig(params.deps, next);
}

function isInvalidGrantError(error: unknown): boolean {
  if (error instanceof OAuthTokenRequestError) {
    return error.oauthError === "invalid_grant";
  }
  return error instanceof Error && /\binvalid_grant\b/i.test(error.message);
}

async function getOAuthAccessToken(params: {
  deps: Pick<CliDeps, "fetch" | "fs" | "homedir" | "env">;
  config: ReturnType<typeof requireConfig>;
  forceRefresh?: boolean;
}): Promise<string> {
  const { deps, config, forceRefresh = false } = params;
  const cacheKey = oauthCacheKey(config);
  const cached = oauthAccessTokenCache.get(cacheKey);
  if (!forceRefresh && cached && shouldReuseAccessToken(cached)) {
    return cached.accessToken;
  }

  if (!forceRefresh) {
    const inflight = oauthAccessTokenInflight.get(cacheKey);
    if (inflight) {
      const settled = await inflight;
      return settled.accessToken;
    }
  }

  const refreshToken = cached?.refreshToken ?? config.token;
  const refreshWithToken = async (currentRefreshToken: string): Promise<OAuthAccessTokenCacheEntry> => {
    const refreshed = await refreshAccessToken({
      deps,
      chatApiUrl: config.chatApiUrl,
      refreshToken: currentRefreshToken,
    });

    const nextEntry: OAuthAccessTokenCacheEntry = {
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken,
      expiresAtMs: Date.now() + refreshed.expiresIn * 1000,
    };
    oauthAccessTokenCache.set(cacheKey, nextEntry);

    if (refreshed.refreshToken !== currentRefreshToken) {
      try {
        persistRotatedRefreshToken({
          deps,
          interfaceUrl: config.url,
          nextRefreshToken: refreshed.refreshToken,
        });
      } catch {
        // Continue with in-memory rotation for this process.
      }
    }

    return nextEntry;
  };

  const refreshPromise = (async () => {
    try {
      return await refreshWithToken(refreshToken);
    } catch (error) {
      if (!isInvalidGrantError(error)) {
        throw error;
      }

      const latestConfig = requireConfig(deps);
      const latestRefreshToken = latestConfig.token;
      if (!isRefreshToken(latestRefreshToken) || latestRefreshToken === refreshToken) {
        throw error;
      }

      return await refreshWithToken(latestRefreshToken);
    }
  })();

  oauthAccessTokenInflight.set(cacheKey, refreshPromise);
  try {
    const settled = await refreshPromise;
    return settled.accessToken;
  } finally {
    oauthAccessTokenInflight.delete(cacheKey);
  }
}

async function resolveBearerToken(params: {
  deps: Pick<CliDeps, "fetch" | "fs" | "homedir" | "env">;
  config: ReturnType<typeof requireConfig>;
  forceRefresh?: boolean;
}): Promise<string> {
  if (!isRefreshToken(params.config.token)) {
    return params.config.token;
  }
  return await getOAuthAccessToken({
    deps: params.deps,
    config: params.config,
    forceRefresh: params.forceRefresh,
  });
}

interface ApiRequestArgs {
  deps: Pick<CliDeps, "fetch" | "fs" | "homedir" | "env">;
  pathname: string;
  method: "GET" | "POST";
  body?: Record<string, unknown>;
  options?: ApiRequestOptions;
}

async function apiRequest(args: ApiRequestArgs): Promise<unknown> {
  const { deps, pathname, method, body, options = {} } = args;
  const cfg = requireConfig(deps);
  const endpoint = toEndpoint(resolveApiBaseUrl(pathname, cfg), pathname);
  const timeoutMs = normalizeTimeoutMs(options.timeoutMs);
  validateCustomHeaders(options.headers);

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  timeout.unref?.();

  const executeWithToken = async (forceRefresh: boolean) => {
    const bearerToken = await resolveBearerToken({
      deps,
      config: cfg,
      forceRefresh,
    });

    const response = await deps.fetch(endpoint, {
      method,
      headers: {
        ...DEFAULT_REQUEST_HEADERS,
        authorization: `Bearer ${bearerToken}`,
        ...(options.headers ?? {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    });

    const text = await response.text();
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { ok: false, error: text };
    }

    return { response, payload };
  };

  let response: Awaited<ReturnType<typeof executeWithToken>>["response"];
  let payload: unknown;
  try {
    const initialAttempt = await executeWithToken(false);
    response = initialAttempt.response;
    payload = initialAttempt.payload;

    if (
      response.status === 401
      && method === "GET"
      && isRefreshToken(cfg.token)
    ) {
      const retryAttempt = await executeWithToken(true);
      response = retryAttempt.response;
      payload = retryAttempt.payload;
    }
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok || (isRecord(payload) && payload.ok === false)) {
    const rawDetail = isRecord(payload) && typeof payload.error === "string" ? payload.error : null;
    throw new ApiRequestError(response.status, rawDetail, payload);
  }

  return payload;
}

export async function apiPost(
  deps: Pick<CliDeps, "fetch" | "fs" | "homedir" | "env">,
  pathname: string,
  body: Record<string, unknown>,
  options: ApiRequestOptions = {}
): Promise<unknown> {
  return apiRequest({
    deps,
    pathname,
    method: "POST",
    body,
    options,
  });
}

export async function apiGet(
  deps: Pick<CliDeps, "fetch" | "fs" | "homedir" | "env">,
  pathname: string,
  options: ApiRequestOptions = {}
): Promise<unknown> {
  return apiRequest({
    deps,
    pathname,
    method: "GET",
    options,
  });
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (isRecord(value)) {
    return value;
  }
  return { result: value };
}
