import { hostname } from "node:os";
import {
  CLI_OAUTH_DEFAULT_SCOPE as CLI_OAUTH_DEFAULT_SCOPE_FROM_WIRE,
  CLI_OAUTH_PUBLIC_CLIENT_ID as CLI_OAUTH_PUBLIC_CLIENT_ID_FROM_WIRE,
  CLI_OAUTH_REDIRECT_PATH as CLI_OAUTH_REDIRECT_PATH_FROM_WIRE,
  CLI_OAUTH_WRITE_SCOPE as CLI_OAUTH_WRITE_SCOPE_FROM_WIRE,
  parseCliOAuthTokenResponse,
  readCliOAuthErrorResponse,
  serializeCliOAuthTokenRequestBody,
  type CliOAuthTokenResponse,
  createPkcePair as createWirePkcePair,
  normalizeCliSessionLabel as normalizeCliSessionLabelFromWire,
} from "@cobuild/wire";
import type { CliDeps, FetchResponseLike } from "./types.js";
import { parseAndValidateApiBaseUrl } from "./url.js";

export const CLI_OAUTH_PUBLIC_CLIENT_ID = CLI_OAUTH_PUBLIC_CLIENT_ID_FROM_WIRE;
export const CLI_OAUTH_REDIRECT_PATH = CLI_OAUTH_REDIRECT_PATH_FROM_WIRE;
export const CLI_OAUTH_DEFAULT_SCOPE = CLI_OAUTH_DEFAULT_SCOPE_FROM_WIRE;
export const CLI_OAUTH_WRITE_SCOPE = CLI_OAUTH_WRITE_SCOPE_FROM_WIRE;
export type CliSetupWalletModeHint = "hosted" | "local-generate" | "local-key";
export type OAuthTokenResponse = CliOAuthTokenResponse;

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
  const errorPayload = readCliOAuthErrorResponse(payload);
  if (errorPayload?.errorDescription) {
    return errorPayload.errorDescription;
  }
  if (errorPayload?.error) {
    return errorPayload.error;
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
    const parsedError = readCliOAuthErrorResponse(payload);
    throw new OAuthTokenRequestError({
      message: readOAuthErrorMessage(payload, `OAuth token request failed (status ${response.status}).`),
      status: response.status,
      oauthError: parsedError?.error ?? null,
      oauthDescription: parsedError?.errorDescription ?? null,
    });
  }
  return parseCliOAuthTokenResponse(payload);
}

export async function createPkcePair(): Promise<{ codeVerifier: string; codeChallenge: string }> {
  return await createWirePkcePair();
}

function normalizeSessionLabel(value: string): string | null {
  try {
    return normalizeCliSessionLabelFromWire(value) ?? null;
  } catch {
    return null;
  }
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
  walletMode?: CliSetupWalletModeHint;
}): string {
  const normalizedBase = params.interfaceUrl.endsWith("/")
    ? params.interfaceUrl
    : `${params.interfaceUrl}/`;
  const url = new URL("home", normalizedBase);
  url.searchParams.set("oauth_authorize", "1");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", params.clientId ?? CLI_OAUTH_PUBLIC_CLIENT_ID);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("scope", params.scope ?? CLI_OAUTH_DEFAULT_SCOPE);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", params.state);
  url.searchParams.set("agent_key", params.agentKey);
  const sessionLabel = normalizeSessionLabel(params.label ?? "") ?? defaultSessionLabel();
  if (sessionLabel) {
    url.searchParams.set("label", sessionLabel);
  }
  if (params.walletMode) {
    url.searchParams.set("wallet_mode", params.walletMode);
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
  return await postOauthToken(
    params.deps,
    params.chatApiUrl,
    serializeCliOAuthTokenRequestBody({
      grantType: "authorization_code",
      clientId: params.clientId ?? CLI_OAUTH_PUBLIC_CLIENT_ID,
      code: params.code,
      redirectUri: params.redirectUri,
      codeVerifier: params.codeVerifier,
    }),
  );
}

export async function refreshAccessToken(params: {
  deps: Pick<CliDeps, "fetch">;
  chatApiUrl: string;
  refreshToken: string;
  clientId?: string;
}): Promise<OAuthTokenResponse> {
  return await postOauthToken(
    params.deps,
    params.chatApiUrl,
    serializeCliOAuthTokenRequestBody({
      grantType: "refresh_token",
      clientId: params.clientId ?? CLI_OAUTH_PUBLIC_CLIENT_ID,
      refreshToken: params.refreshToken,
    }),
  );
}
