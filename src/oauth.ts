import { createHash, randomBytes } from "node:crypto";
import { hostname } from "node:os";
import type { CliDeps, FetchResponseLike } from "./types.js";
import { parseAndValidateApiBaseUrl } from "./url.js";

export const OAUTH_CLIENT_ID = "buildbot_cli";
export const OAUTH_REDIRECT_PATH = "/auth/callback";
export const OAUTH_DEFAULT_SCOPE = [
  "tools:read",
  "tools:write",
  "wallet:read",
  "wallet:execute",
  "offline_access",
].join(" ");

const PKCE_VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/;
export type CliSetupPayerModeHint = "hosted" | "local-generate" | "local-key" | "skip";

export type OAuthTokenResponse = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scope: string;
  sessionId: string | null;
};

type OAuthTokenErrorPayload = {
  error?: unknown;
  error_description?: unknown;
};

export class OAuthTokenRequestError extends Error {
  readonly status: number;
  readonly oauthError: string | null;
  readonly oauthDescription: string | null;

  constructor(params: {
    message: string;
    status: number;
    oauthError: string | null;
    oauthDescription: string | null;
  }) {
    super(params.message);
    this.name = "OAuthTokenRequestError";
    this.status = params.status;
    this.oauthError = params.oauthError;
    this.oauthDescription = params.oauthDescription;
  }
}

function toEndpoint(baseUrl: string, pathname: string): URL {
  const validatedBase = parseAndValidateApiBaseUrl(baseUrl, "Chat API URL");
  const normalizedBase = validatedBase.href.endsWith("/")
    ? validatedBase.href
    : `${validatedBase.href}/`;
  const normalizedPath = pathname.startsWith("/") ? pathname.slice(1) : pathname;
  return new URL(normalizedPath, normalizedBase);
}

function parseJsonResponse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function readOAuthErrorMessage(payload: unknown, fallback: string): string {
  const errorPayload = parseOAuthErrorPayload(payload);
  if (errorPayload.oauthDescription) {
    return errorPayload.oauthDescription;
  }
  if (errorPayload.oauthError) {
    return errorPayload.oauthError;
  }
  return fallback;
}

function parseOAuthErrorPayload(payload: unknown): {
  oauthError: string | null;
  oauthDescription: string | null;
} {
  if (!payload || typeof payload !== "object") {
    return {
      oauthError: null,
      oauthDescription: null,
    };
  }
  const errorPayload = payload as OAuthTokenErrorPayload;
  return {
    oauthError:
      typeof errorPayload.error === "string" && errorPayload.error.trim()
        ? errorPayload.error
        : null,
    oauthDescription:
      typeof errorPayload.error_description === "string" && errorPayload.error_description.trim()
        ? errorPayload.error_description
        : null,
  };
}

function parseOAuthTokenResponse(payload: unknown): OAuthTokenResponse {
  if (!payload || typeof payload !== "object") {
    throw new Error("OAuth token response was not valid JSON.");
  }
  const record = payload as {
    access_token?: unknown;
    refresh_token?: unknown;
    expires_in?: unknown;
    scope?: unknown;
    session_id?: unknown;
  };

  if (typeof record.access_token !== "string" || !record.access_token.trim()) {
    throw new Error("OAuth token response did not include access_token.");
  }
  if (typeof record.refresh_token !== "string" || !record.refresh_token.trim()) {
    throw new Error("OAuth token response did not include refresh_token.");
  }
  if (typeof record.expires_in !== "number" || !Number.isFinite(record.expires_in) || record.expires_in <= 0) {
    throw new Error("OAuth token response did not include a valid expires_in.");
  }

  return {
    accessToken: record.access_token,
    refreshToken: record.refresh_token,
    expiresIn: Math.floor(record.expires_in),
    scope: typeof record.scope === "string" ? record.scope : "",
    sessionId: typeof record.session_id === "string" ? record.session_id : null,
  };
}

async function postOauthToken(
  deps: Pick<CliDeps, "fetch">,
  chatApiUrl: string,
  body: Record<string, unknown>
): Promise<OAuthTokenResponse> {
  const endpoint = toEndpoint(chatApiUrl, "/oauth/token");
  let response: FetchResponseLike;
  try {
    response = await deps.fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new Error(
      `OAuth token request failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const text = await response.text();
  const payload = parseJsonResponse(text);
  if (!response.ok) {
    const parsedError = parseOAuthErrorPayload(payload);
    throw new OAuthTokenRequestError({
      message: readOAuthErrorMessage(payload, `OAuth token request failed (status ${response.status}).`),
      status: response.status,
      oauthError: parsedError.oauthError,
      oauthDescription: parsedError.oauthDescription,
    });
  }
  return parseOAuthTokenResponse(payload);
}

export function createPkcePair(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = randomBytes(32).toString("base64url");
  if (!PKCE_VERIFIER_PATTERN.test(codeVerifier)) {
    throw new Error("Failed to generate a valid PKCE code_verifier.");
  }
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  return {
    codeVerifier,
    codeChallenge,
  };
}

function normalizeSessionLabel(value: string): string | null {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return null;
  }
  return normalized.slice(0, 128);
}

function defaultSessionLabel(): string | null {
  try {
    return normalizeSessionLabel(hostname());
  } catch {
    return null;
  }
}

export function buildCliAuthorizeUrl(params: {
  interfaceUrl: string;
  redirectUri: string;
  state: string;
  scope?: string;
  codeChallenge: string;
  clientId?: string;
  agentKey: string;
  label?: string;
  payerMode?: CliSetupPayerModeHint;
}): string {
  const normalizedBase = params.interfaceUrl.endsWith("/")
    ? params.interfaceUrl
    : `${params.interfaceUrl}/`;
  const url = new URL("home", normalizedBase);
  url.searchParams.set("oauth_authorize", "1");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", params.clientId ?? OAUTH_CLIENT_ID);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("scope", params.scope ?? OAUTH_DEFAULT_SCOPE);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", params.state);
  url.searchParams.set("agent_key", params.agentKey);
  const sessionLabel = normalizeSessionLabel(params.label ?? "") ?? defaultSessionLabel();
  if (sessionLabel) {
    url.searchParams.set("label", sessionLabel);
  }
  if (params.payerMode) {
    url.searchParams.set("payer_mode", params.payerMode);
  }
  return url.toString();
}

export async function exchangeAuthorizationCode(params: {
  deps: Pick<CliDeps, "fetch">;
  chatApiUrl: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
  clientId?: string;
}): Promise<OAuthTokenResponse> {
  return await postOauthToken(params.deps, params.chatApiUrl, {
    grant_type: "authorization_code",
    client_id: params.clientId ?? OAUTH_CLIENT_ID,
    code: params.code,
    redirect_uri: params.redirectUri,
    code_verifier: params.codeVerifier,
  });
}

export async function refreshAccessToken(params: {
  deps: Pick<CliDeps, "fetch">;
  chatApiUrl: string;
  refreshToken: string;
  clientId?: string;
}): Promise<OAuthTokenResponse> {
  return await postOauthToken(params.deps, params.chatApiUrl, {
    grant_type: "refresh_token",
    client_id: params.clientId ?? OAUTH_CLIENT_ID,
    refresh_token: params.refreshToken,
  });
}
