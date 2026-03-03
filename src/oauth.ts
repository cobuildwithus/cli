import { createHash, randomBytes } from "node:crypto";
import { hostname } from "node:os";
import {
  OAUTH_CLIENT_ID as OAUTH_CLIENT_ID_FROM_WIRE,
  OAUTH_DEFAULT_SCOPE as OAUTH_DEFAULT_SCOPE_FROM_WIRE,
  OAUTH_REDIRECT_PATH as OAUTH_REDIRECT_PATH_FROM_WIRE,
  OAUTH_WRITE_SCOPE as OAUTH_WRITE_SCOPE_FROM_WIRE,
  validatePkceCodeVerifier,
} from "@cobuild/wire";
import { parseOAuthErrorPayload, parseOAuthTokenPayload } from "./api-response-schemas.js";
import type { CliDeps, FetchResponseLike } from "./types.js";
import { parseAndValidateApiBaseUrl } from "./url.js";

export const OAUTH_CLIENT_ID = OAUTH_CLIENT_ID_FROM_WIRE;
export const OAUTH_REDIRECT_PATH = OAUTH_REDIRECT_PATH_FROM_WIRE;
export const OAUTH_DEFAULT_SCOPE = OAUTH_DEFAULT_SCOPE_FROM_WIRE;
export const OAUTH_WRITE_SCOPE = OAUTH_WRITE_SCOPE_FROM_WIRE;
export type CliSetupPayerModeHint = "hosted" | "local-generate" | "local-key" | "skip";

export type OAuthTokenResponse = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scope: string;
  sessionId: string | null;
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
  return parseOAuthTokenPayload(payload);
}

export function createPkcePair(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = randomBytes(32).toString("base64url");
  validatePkceCodeVerifier(codeVerifier);
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
