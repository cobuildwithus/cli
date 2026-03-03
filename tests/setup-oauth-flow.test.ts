import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createPkcePair: vi.fn(),
  exchangeAuthorizationCode: vi.fn(),
  buildSetupApprovalUrl: vi.fn(),
  createSetupApprovalSession: vi.fn(),
}));

vi.mock("../src/oauth.js", async () => {
  const actual = await vi.importActual<typeof import("../src/oauth.js")>("../src/oauth.js");
  return {
    ...actual,
    createPkcePair: (...args: unknown[]) => mocks.createPkcePair(...args),
    exchangeAuthorizationCode: (...args: unknown[]) => mocks.exchangeAuthorizationCode(...args),
  };
});

vi.mock("../src/setup-approval.js", async () => {
  const actual = await vi.importActual<typeof import("../src/setup-approval.js")>(
    "../src/setup-approval.js"
  );
  return {
    ...actual,
    buildSetupApprovalUrl: (...args: unknown[]) => mocks.buildSetupApprovalUrl(...args),
    createSetupApprovalSession: (...args: unknown[]) => mocks.createSetupApprovalSession(...args),
  };
});

import { CLI_OAUTH_DEFAULT_SCOPE } from "../src/oauth.js";
import { redactApprovalUrlForDisplay, requestRefreshTokenViaBrowser } from "../src/setup/oauth-flow.js";

describe("setup oauth flow url redaction", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("redacts sensitive approval query params", () => {
    const redacted = redactApprovalUrlForDisplay(
      "https://co.build/home?oauth_authorize=1&state=abc123&code_challenge=def456&redirect_uri=http%3A%2F%2F127.0.0.1%3A43111%2Fauth%2Fcallback&scope=tools%3Aread&agent_key=default"
    );
    const url = new URL(redacted);
    expect(url.searchParams.get("state")).toBe("<redacted>");
    expect(url.searchParams.get("code_challenge")).toBe("<redacted>");
    expect(url.searchParams.get("redirect_uri")).toBe("<redacted>");
    expect(url.searchParams.get("scope")).toBe("tools:read");
  });

  it("prints a redacted manual URL by default when browser open fails", async () => {
    const errors: string[] = [];
    mocks.createPkcePair.mockResolvedValue({
      codeVerifier: "A".repeat(43),
      codeChallenge: "B".repeat(43),
    });
    mocks.buildSetupApprovalUrl.mockReturnValue(
      "https://co.build/home?oauth_authorize=1&state=state123&code_challenge=challenge123&redirect_uri=http%3A%2F%2F127.0.0.1%3A43111%2Fauth%2Fcallback&scope=offline_access%20tools%3Aread%20wallet%3Aread&agent_key=default"
    );
    mocks.createSetupApprovalSession.mockResolvedValue({
      callbackUrl: "http://127.0.0.1:43111/auth/callback",
      state: "state123",
      waitForCode: Promise.resolve("OAUTH_AUTHORIZATION_CODE_1234567890"),
      close: vi.fn().mockResolvedValue(undefined),
    });
    mocks.exchangeAuthorizationCode.mockResolvedValue({
      accessToken: "access",
      refreshToken: "refresh",
      expiresIn: 600,
      scope: CLI_OAUTH_DEFAULT_SCOPE,
      sessionId: "session-1",
    });

    const refreshToken = await requestRefreshTokenViaBrowser({
      interfaceUrl: "https://co.build",
      chatApiUrl: "https://chat.co.build",
      agent: "default",
      scope: CLI_OAUTH_DEFAULT_SCOPE,
      showApprovalUrl: false,
      deps: {
        stderr: (message: string) => errors.push(message),
        openExternal: () => false,
      } as unknown as Parameters<typeof requestRefreshTokenViaBrowser>[0]["deps"],
    });

    expect(refreshToken).toBe("refresh");
    expect(errors.some((line) => line.includes("Open this URL manually: https://co.build/home?"))).toBe(true);
    expect(errors.some((line) => line.includes("%3Credacted%3E"))).toBe(true);
    expect(errors.some((line) => line.includes("Re-run with --show-approval-url"))).toBe(true);
    expect(errors.some((line) => line.includes("state=state123"))).toBe(false);
  });

  it("prints the full approval URL when --show-approval-url is enabled", async () => {
    const errors: string[] = [];
    const approvalUrl =
      "https://co.build/home?oauth_authorize=1&state=state123&code_challenge=challenge123&redirect_uri=http%3A%2F%2F127.0.0.1%3A43111%2Fauth%2Fcallback&scope=offline_access%20tools%3Aread%20wallet%3Aread&agent_key=default";
    mocks.createPkcePair.mockResolvedValue({
      codeVerifier: "A".repeat(43),
      codeChallenge: "B".repeat(43),
    });
    mocks.buildSetupApprovalUrl.mockReturnValue(approvalUrl);
    mocks.createSetupApprovalSession.mockResolvedValue({
      callbackUrl: "http://127.0.0.1:43111/auth/callback",
      state: "state123",
      waitForCode: Promise.resolve("OAUTH_AUTHORIZATION_CODE_1234567890"),
      close: vi.fn().mockResolvedValue(undefined),
    });
    mocks.exchangeAuthorizationCode.mockResolvedValue({
      accessToken: "access",
      refreshToken: "refresh",
      expiresIn: 600,
      scope: CLI_OAUTH_DEFAULT_SCOPE,
      sessionId: "session-1",
    });

    const refreshToken = await requestRefreshTokenViaBrowser({
      interfaceUrl: "https://co.build",
      chatApiUrl: "https://chat.co.build",
      agent: "default",
      scope: CLI_OAUTH_DEFAULT_SCOPE,
      showApprovalUrl: true,
      deps: {
        stderr: (message: string) => errors.push(message),
        openExternal: () => false,
      } as unknown as Parameters<typeof requestRefreshTokenViaBrowser>[0]["deps"],
    });

    expect(refreshToken).toBe("refresh");
    expect(errors).toContain(`Approval URL: ${approvalUrl}`);
    expect(errors).toContain(`Open this URL manually: ${approvalUrl}`);
  });
});
