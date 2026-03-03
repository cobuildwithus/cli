import { describe, expect, it, vi } from "vitest";
import {
  buildCliAuthorizeUrl,
  createPkcePair,
  exchangeAuthorizationCode,
  OAUTH_CLIENT_ID,
  OAUTH_DEFAULT_SCOPE,
  OAuthTokenRequestError,
  refreshAccessToken,
} from "../src/oauth.js";

function createDeps(fetchImpl: (input: URL | string, init?: Record<string, unknown>) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}>) {
  return {
    fetch: vi.fn(fetchImpl),
  };
}

describe("oauth helpers", () => {
  it("creates valid PKCE verifier/challenge pairs", () => {
    const { codeVerifier, codeChallenge } = createPkcePair();
    expect(codeVerifier).toMatch(/^[A-Za-z0-9._~-]{43,128}$/);
    expect(codeChallenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("builds authorize URL with explicit and default label behavior", () => {
    const withLabel = new URL(
      buildCliAuthorizeUrl({
        interfaceUrl: "https://co.build",
        redirectUri: "http://127.0.0.1:43111/auth/callback",
        state: "state-1",
        codeChallenge: "A".repeat(43),
        agentKey: "default",
        label: "  laptop-main  ",
        payerMode: "hosted",
      })
    );
    expect(withLabel.searchParams.get("client_id")).toBe(OAUTH_CLIENT_ID);
    expect(withLabel.searchParams.get("scope")).toBe(OAUTH_DEFAULT_SCOPE);
    expect(withLabel.searchParams.get("label")).toBe("laptop-main");
    expect(withLabel.searchParams.get("payer_mode")).toBe("hosted");

    const withoutLabel = new URL(
      buildCliAuthorizeUrl({
        interfaceUrl: "https://co.build/",
        redirectUri: "http://127.0.0.1:43112/auth/callback",
        state: "state-2",
        codeChallenge: "B".repeat(43),
        agentKey: "default",
        label: "   ",
      })
    );
    expect(withoutLabel.searchParams.get("oauth_authorize")).toBe("1");
    expect(withoutLabel.searchParams.get("label")).toBeTruthy();
  });

  it("exchanges authorization code tokens", async () => {
    const deps = createDeps(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          access_token: "access-1",
          refresh_token: "rfr_1",
          expires_in: 600,
          scope: "tools:read offline_access",
          session_id: "11",
        }),
    }));

    const response = await exchangeAuthorizationCode({
      deps,
      chatApiUrl: "https://chat.example",
      code: "code-1",
      redirectUri: "http://127.0.0.1:43111/auth/callback",
      codeVerifier: "A".repeat(43),
    });

    expect(response).toEqual({
      accessToken: "access-1",
      refreshToken: "rfr_1",
      expiresIn: 600,
      scope: "tools:read offline_access",
      sessionId: "11",
    });
    expect(deps.fetch).toHaveBeenCalledWith(
      new URL("https://chat.example/oauth/token"),
      expect.objectContaining({
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
      })
    );
    expect(JSON.parse(String(deps.fetch.mock.calls[0]?.[1]?.body))).toEqual({
      grant_type: "authorization_code",
      client_id: "buildbot_cli",
      code: "code-1",
      redirect_uri: "http://127.0.0.1:43111/auth/callback",
      code_verifier: "A".repeat(43),
    });
  });

  it("refreshes access tokens", async () => {
    const deps = createDeps(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          access_token: "access-2",
          refresh_token: "rfr_2",
          expires_in: 900,
        }),
    }));

    await expect(
      refreshAccessToken({
        deps,
        chatApiUrl: "https://chat.example",
        refreshToken: "rfr_old",
      })
    ).resolves.toEqual({
      accessToken: "access-2",
      refreshToken: "rfr_2",
      expiresIn: 900,
      scope: "",
      sessionId: null,
    });
    expect(JSON.parse(String(deps.fetch.mock.calls[0]?.[1]?.body))).toEqual({
      grant_type: "refresh_token",
      client_id: "buildbot_cli",
      refresh_token: "rfr_old",
    });
  });

  it("surfaces structured oauth token errors", async () => {
    const deps = createDeps(async () => ({
      ok: false,
      status: 400,
      text: async () =>
        JSON.stringify({
          error: "invalid_grant",
          error_description: "Refresh token is invalid or expired",
        }),
    }));

    await expect(
      refreshAccessToken({
        deps,
        chatApiUrl: "https://chat.example",
        refreshToken: "rfr_bad",
      })
    ).rejects.toEqual(
      expect.objectContaining<Partial<OAuthTokenRequestError>>({
        name: "OAuthTokenRequestError",
        status: 400,
        oauthError: "invalid_grant",
        oauthDescription: "Refresh token is invalid or expired",
      })
    );
  });

  it("uses fallback oauth error messages and validates payload schema", async () => {
    const badJsonDeps = createDeps(async () => ({
      ok: true,
      status: 200,
      text: async () => "{bad",
    }));
    await expect(
      refreshAccessToken({
        deps: badJsonDeps,
        chatApiUrl: "https://chat.example",
        refreshToken: "rfr_bad",
      })
    ).rejects.toThrow("OAuth token response was not valid JSON.");

    const missingAccessTokenDeps = createDeps(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          refresh_token: "rfr_bad",
          expires_in: 10,
        }),
    }));
    await expect(
      refreshAccessToken({
        deps: missingAccessTokenDeps,
        chatApiUrl: "https://chat.example",
        refreshToken: "rfr_bad",
      })
    ).rejects.toThrow("OAuth token response did not include access_token.");

    const fallbackErrorDeps = createDeps(async () => ({
      ok: false,
      status: 503,
      text: async () => "non-json-error",
    }));
    await expect(
      refreshAccessToken({
        deps: fallbackErrorDeps,
        chatApiUrl: "https://chat.example",
        refreshToken: "rfr_bad",
      })
    ).rejects.toThrow("OAuth token request failed (status 503).");
  });

  it("surfaces request transport failures", async () => {
    const deps = createDeps(async () => {
      throw new Error("network down");
    });

    await expect(
      exchangeAuthorizationCode({
        deps,
        chatApiUrl: "https://chat.example",
        code: "code-1",
        redirectUri: "http://127.0.0.1:43111/auth/callback",
        codeVerifier: "A".repeat(43),
      })
    ).rejects.toThrow("OAuth token request failed: network down");
  });
});
