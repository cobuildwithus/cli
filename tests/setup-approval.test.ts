import { describe, expect, it } from "vitest";
import {
  buildSetupApprovalUrl,
  createSetupApprovalSession,
  isValidSetupState,
} from "../src/setup-approval.js";

const TEST_ORIGIN = "http://localhost:3000";

describe("setup approval flow", () => {
  it("builds approval URL for /home with setup params", () => {
    const url = buildSetupApprovalUrl({
      baseUrl: TEST_ORIGIN,
      callbackUrl: "http://127.0.0.1:4123/api/buildbot/cli/callback/state123_state123_state123_state123",
      state: "state123_state123_state123_state123",
      network: "base-sepolia",
      agent: "default",
    });

    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/home");
    expect(parsed.searchParams.get("buildBotSetup")).toBe("1");
    expect(parsed.searchParams.get("buildBotCallback")).toContain("127.0.0.1");
    const callbackUrl = new URL(parsed.searchParams.get("buildBotCallback") ?? "");
    expect(callbackUrl.pathname.startsWith("/api/buildbot/cli/callback/")).toBe(true);
    expect(parsed.searchParams.get("buildBotNetwork")).toBe("base-sepolia");
    expect(parsed.searchParams.get("buildBotAgent")).toBe("default");
  });

  it("validates setup state format", () => {
    expect(isValidSetupState("short")).toBe(false);
    expect(isValidSetupState("state123_state123_state123_state123")).toBe(true);
  });

  it("throws when approval URL state is invalid", () => {
    expect(() =>
      buildSetupApprovalUrl({
        baseUrl: TEST_ORIGIN,
        callbackUrl: "http://127.0.0.1:1234/api/buildbot/cli/callback/abc",
        state: "bad",
        network: "base-sepolia",
        agent: "default",
      })
    ).toThrow("Invalid setup state");
  });

  it("rejects invalid session state input", async () => {
    await expect(
      createSetupApprovalSession({
        expectedOrigin: TEST_ORIGIN,
        state: "bad",
      })
    ).rejects.toThrow("Invalid setup state");
  });

  it("accepts browser callback only from expected origin with matching state", async () => {
    const state = "state123_state123_state123_state123";
    const session = await createSetupApprovalSession({
      expectedOrigin: TEST_ORIGIN,
      state,
      timeoutMs: 2_000,
    });

    const optionsResponse = await fetch(session.callbackUrl, {
      method: "OPTIONS",
      headers: {
        Origin: TEST_ORIGIN,
        "Access-Control-Request-Method": "POST",
      },
    });

    expect(optionsResponse.status).toBe(204);
    expect(optionsResponse.headers.get("access-control-allow-origin")).toBe(TEST_ORIGIN);

    const callbackResponse = await fetch(session.callbackUrl, {
      method: "POST",
      headers: {
        Origin: TEST_ORIGIN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        state,
        token: "bbt_secure_token",
      }),
    });

    expect(callbackResponse.status).toBe(200);
    await expect(session.waitForToken).resolves.toBe("bbt_secure_token");
    await session.close();
  });

  it("accepts loopback host aliases when protocol and port match", async () => {
    const state = "state123_state123_state123_state123";
    const session = await createSetupApprovalSession({
      expectedOrigin: TEST_ORIGIN,
      state,
      timeoutMs: 2_000,
    });
    const aliasedOrigin = "http://127.0.0.1:3000";

    const optionsResponse = await fetch(session.callbackUrl, {
      method: "OPTIONS",
      headers: {
        Origin: aliasedOrigin,
        "Access-Control-Request-Method": "POST",
      },
    });

    expect(optionsResponse.status).toBe(204);
    expect(optionsResponse.headers.get("access-control-allow-origin")).toBe(aliasedOrigin);

    const callbackResponse = await fetch(session.callbackUrl, {
      method: "POST",
      headers: {
        Origin: aliasedOrigin,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        state,
        token: "bbt_secure_token",
      }),
    });

    expect(callbackResponse.status).toBe(200);
    await expect(session.waitForToken).resolves.toBe("bbt_secure_token");
    await session.close();
  });

  it("rejects OPTIONS preflight from unexpected origin", async () => {
    const state = "state123_state123_state123_state123";
    const session = await createSetupApprovalSession({
      expectedOrigin: TEST_ORIGIN,
      state,
      timeoutMs: 2_000,
    });

    const optionsResponse = await fetch(session.callbackUrl, {
      method: "OPTIONS",
      headers: {
        Origin: "http://evil.local",
        "Access-Control-Request-Method": "POST",
      },
    });

    expect(optionsResponse.status).toBe(403);
    await session.close();
    await expect(session.waitForToken).rejects.toThrow("Setup approval session closed");
  });

  it("rejects loopback origin with mismatched port", async () => {
    const state = "state123_state123_state123_state123";
    const session = await createSetupApprovalSession({
      expectedOrigin: TEST_ORIGIN,
      state,
      timeoutMs: 2_000,
    });

    const optionsResponse = await fetch(session.callbackUrl, {
      method: "OPTIONS",
      headers: {
        Origin: "http://127.0.0.1:3001",
        "Access-Control-Request-Method": "POST",
      },
    });

    expect(optionsResponse.status).toBe(403);
    await session.close();
    await expect(session.waitForToken).rejects.toThrow("Setup approval session closed");
  });

  it("rejects malformed origin headers during preflight", async () => {
    const state = "state123_state123_state123_state123";
    const session = await createSetupApprovalSession({
      expectedOrigin: TEST_ORIGIN,
      state,
      timeoutMs: 2_000,
    });

    const optionsResponse = await fetch(session.callbackUrl, {
      method: "OPTIONS",
      headers: {
        Origin: "::not-a-valid-origin::",
        "Access-Control-Request-Method": "POST",
      },
    });

    expect(optionsResponse.status).toBe(403);
    await session.close();
    await expect(session.waitForToken).rejects.toThrow("Setup approval session closed");
  });

  it("rejects loopback alias when protocol differs", async () => {
    const state = "state123_state123_state123_state123";
    const session = await createSetupApprovalSession({
      expectedOrigin: TEST_ORIGIN,
      state,
      timeoutMs: 2_000,
    });

    const optionsResponse = await fetch(session.callbackUrl, {
      method: "OPTIONS",
      headers: {
        Origin: "https://127.0.0.1:3000",
        "Access-Control-Request-Method": "POST",
      },
    });

    expect(optionsResponse.status).toBe(403);
    await session.close();
    await expect(session.waitForToken).rejects.toThrow("Setup approval session closed");
  });

  it("requires exact host match for non-loopback expected origins", async () => {
    const state = "state123_state123_state123_state123";
    const expectedOrigin = "https://co.build";
    const session = await createSetupApprovalSession({
      expectedOrigin,
      state,
      timeoutMs: 2_000,
    });

    const allowedPreflight = await fetch(session.callbackUrl, {
      method: "OPTIONS",
      headers: {
        Origin: expectedOrigin,
        "Access-Control-Request-Method": "POST",
      },
    });
    expect(allowedPreflight.status).toBe(204);
    expect(allowedPreflight.headers.get("access-control-allow-origin")).toBe(expectedOrigin);

    const deniedPreflight = await fetch(session.callbackUrl, {
      method: "OPTIONS",
      headers: {
        Origin: "https://www.co.build",
        "Access-Control-Request-Method": "POST",
      },
    });
    expect(deniedPreflight.status).toBe(403);

    const callbackResponse = await fetch(session.callbackUrl, {
      method: "POST",
      headers: {
        Origin: expectedOrigin,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        state,
        token: "bbt_secure_token",
      }),
    });

    expect(callbackResponse.status).toBe(200);
    await expect(session.waitForToken).resolves.toBe("bbt_secure_token");
    await session.close();
  });

  it("returns 405 for unsupported methods", async () => {
    const state = "state123_state123_state123_state123";
    const session = await createSetupApprovalSession({
      expectedOrigin: TEST_ORIGIN,
      state,
      timeoutMs: 2_000,
    });

    const response = await fetch(session.callbackUrl, {
      method: "GET",
      headers: {
        Origin: TEST_ORIGIN,
      },
    });

    expect(response.status).toBe(405);
    await session.close();
    await expect(session.waitForToken).rejects.toThrow("Setup approval session closed");
  });

  it("returns 404 for callback paths that do not match the setup state", async () => {
    const state = "state123_state123_state123_state123";
    const session = await createSetupApprovalSession({
      expectedOrigin: TEST_ORIGIN,
      state,
      timeoutMs: 2_000,
    });
    const wrongUrl = new URL(session.callbackUrl);
    wrongUrl.pathname = "/api/buildbot/cli/callback/other_state";

    const response = await fetch(wrongUrl, {
      method: "POST",
      headers: {
        Origin: TEST_ORIGIN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ state, token: "bbt_secure_token" }),
    });

    expect(response.status).toBe(404);
    await session.close();
    await expect(session.waitForToken).rejects.toThrow("Setup approval session closed");
  });

  it("rejects callback from unexpected origin", async () => {
    const state = "state123_state123_state123_state123";
    const session = await createSetupApprovalSession({
      expectedOrigin: TEST_ORIGIN,
      state,
      timeoutMs: 2_000,
    });

    const callbackResponse = await fetch(session.callbackUrl, {
      method: "POST",
      headers: {
        Origin: "http://evil.local",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        state,
        token: "bbt_secure_token",
      }),
    });

    expect(callbackResponse.status).toBe(403);
    await session.close();
    await expect(session.waitForToken).rejects.toThrow("Setup approval session closed");
  });

  it("rejects callback when browser origin header is missing", async () => {
    const state = "state123_state123_state123_state123";
    const session = await createSetupApprovalSession({
      expectedOrigin: TEST_ORIGIN,
      state,
      timeoutMs: 2_000,
    });

    const callbackResponse = await fetch(session.callbackUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        state,
        token: "bbt_secure_token",
      }),
    });

    expect(callbackResponse.status).toBe(403);
    await session.close();
    await expect(session.waitForToken).rejects.toThrow("Setup approval session closed");
  });

  it("rejects malformed callback payloads", async () => {
    const state = "state123_state123_state123_state123";

    const missingBodySession = await createSetupApprovalSession({
      expectedOrigin: TEST_ORIGIN,
      state,
      timeoutMs: 2_000,
    });
    const missingBodyResponse = await fetch(missingBodySession.callbackUrl, {
      method: "POST",
      headers: {
        Origin: TEST_ORIGIN,
        "Content-Type": "application/json",
      },
    });
    expect(missingBodyResponse.status).toBe(400);
    await missingBodySession.close();
    await expect(missingBodySession.waitForToken).rejects.toThrow("Setup approval session closed");

    const badJsonSession = await createSetupApprovalSession({
      expectedOrigin: TEST_ORIGIN,
      state,
      timeoutMs: 2_000,
    });
    const badJsonResponse = await fetch(badJsonSession.callbackUrl, {
      method: "POST",
      headers: {
        Origin: TEST_ORIGIN,
        "Content-Type": "application/json",
      },
      body: "{bad json",
    });
    expect(badJsonResponse.status).toBe(400);
    await badJsonSession.close();
    await expect(badJsonSession.waitForToken).rejects.toThrow("Setup approval session closed");

    const nonObjectBodySession = await createSetupApprovalSession({
      expectedOrigin: TEST_ORIGIN,
      state,
      timeoutMs: 2_000,
    });
    const nonObjectBodyResponse = await fetch(nonObjectBodySession.callbackUrl, {
      method: "POST",
      headers: {
        Origin: TEST_ORIGIN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(123),
    });
    expect(nonObjectBodyResponse.status).toBe(400);
    await nonObjectBodySession.close();
    await expect(nonObjectBodySession.waitForToken).rejects.toThrow(
      "Setup approval session closed"
    );

    const wrongStateSession = await createSetupApprovalSession({
      expectedOrigin: TEST_ORIGIN,
      state,
      timeoutMs: 2_000,
    });
    const wrongStateResponse = await fetch(wrongStateSession.callbackUrl, {
      method: "POST",
      headers: {
        Origin: TEST_ORIGIN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        state: "state123_state123_state123_state124",
        token: "bbt_secure_token",
      }),
    });
    expect(wrongStateResponse.status).toBe(400);
    await wrongStateSession.close();
    await expect(wrongStateSession.waitForToken).rejects.toThrow("Setup approval session closed");

    const badTokenSession = await createSetupApprovalSession({
      expectedOrigin: TEST_ORIGIN,
      state,
      timeoutMs: 2_000,
    });
    const badTokenResponse = await fetch(badTokenSession.callbackUrl, {
      method: "POST",
      headers: {
        Origin: TEST_ORIGIN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        state,
        token: "not_a_build_bot_token",
      }),
    });
    expect(badTokenResponse.status).toBe(400);
    await badTokenSession.close();
    await expect(badTokenSession.waitForToken).rejects.toThrow("Setup approval session closed");
  });

  it("times out when no approval is received", async () => {
    const state = "state123_state123_state123_state123";
    const session = await createSetupApprovalSession({
      expectedOrigin: TEST_ORIGIN,
      state,
      timeoutMs: 20,
    });

    await expect(session.waitForToken).rejects.toThrow("Timed out waiting for browser approval");
    await session.close();
  });
});
