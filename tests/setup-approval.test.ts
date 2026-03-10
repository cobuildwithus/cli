import { afterEach, describe, expect, it } from "vitest";
import { CLI_OAUTH_DEFAULT_SCOPE, CLI_OAUTH_PUBLIC_CLIENT_ID } from "../src/oauth.js";
import {
  buildSetupApprovalUrl,
  createSetupApprovalSession,
  isValidSetupState,
} from "../src/setup-approval.js";

async function closeSessionSilently(session: Awaited<ReturnType<typeof createSetupApprovalSession>>) {
  try {
    await session.close();
  } catch {
    // no-op
  }
}

describe("setup approval", () => {
  const sessions = new Set<Awaited<ReturnType<typeof createSetupApprovalSession>>>();

  afterEach(async () => {
    await Promise.all(Array.from(sessions).map(async (session) => await closeSessionSilently(session)));
    sessions.clear();
  });

  it("builds an OAuth authorize URL with PKCE parameters", () => {
    const callbackUrl = "http://127.0.0.1:43111/auth/callback";
    const url = buildSetupApprovalUrl({
      baseUrl: "https://co.build",
      callbackUrl,
      state: "a".repeat(32),
      agent: "default",
      scope: CLI_OAUTH_DEFAULT_SCOPE,
      codeChallenge: "Z8R1pYwAqfejb9Lk7V3G5KjN9V2n8cQtq7mQh4v2XEc",
      label: "cli-default",
      walletMode: "hosted",
    });

    const parsed = new URL(url);
    expect(parsed.origin).toBe("https://co.build");
    expect(parsed.pathname).toBe("/home");
    expect(parsed.searchParams.get("oauth_authorize")).toBe("1");
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("client_id")).toBe(CLI_OAUTH_PUBLIC_CLIENT_ID);
    expect(parsed.searchParams.get("redirect_uri")).toBe(callbackUrl);
    expect(parsed.searchParams.get("state")).toBe("a".repeat(32));
    expect(parsed.searchParams.get("scope")).toBe(CLI_OAUTH_DEFAULT_SCOPE);
    expect(parsed.searchParams.get("agent_key")).toBe("default");
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
    expect(parsed.searchParams.get("label")).toBe("cli-default");
    expect(parsed.searchParams.get("wallet_mode")).toBe("hosted");
    expect(parsed.searchParams.get("payer_mode")).toBeNull();
  });

  it("rejects invalid setup state values", () => {
    expect(isValidSetupState("short")).toBe(false);
    expect(() =>
      buildSetupApprovalUrl({
        baseUrl: "https://co.build",
        callbackUrl: "http://127.0.0.1:12345/auth/callback",
        state: "bad state",
        agent: "default",
        scope: CLI_OAUTH_DEFAULT_SCOPE,
        codeChallenge: "Z8R1pYwAqfejb9Lk7V3G5KjN9V2n8cQtq7mQh4v2XEc",
      })
    ).toThrow("Invalid setup state");
  });

  it("adds a default session label when one is not provided", () => {
    const url = buildSetupApprovalUrl({
      baseUrl: "https://co.build",
      callbackUrl: "http://127.0.0.1:43210/auth/callback",
      state: "b".repeat(32),
      agent: "default",
      scope: CLI_OAUTH_DEFAULT_SCOPE,
      codeChallenge: "Z8R1pYwAqfejb9Lk7V3G5KjN9V2n8cQtq7mQh4v2XEc",
    });

    const parsed = new URL(url);
    const label = parsed.searchParams.get("label");
    expect(label).toBeTruthy();
    expect((label ?? "").length).toBeLessThanOrEqual(128);
  });

  it("accepts callback GET and resolves authorization code", async () => {
    const session = await createSetupApprovalSession({
      state: "S".repeat(32),
      timeoutMs: 5_000,
    });
    sessions.add(session);

    const callback = new URL(session.callbackUrl);
    const code = "OAUTH_AUTHORIZATION_CODE_1234567890";
    callback.searchParams.set("state", session.state);
    callback.searchParams.set("code", code);

    const response = await fetch(callback, { method: "GET" });
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("CLI authorization complete");

    await expect(session.waitForCode).resolves.toBe(code);
  });

  it("rejects callback requests with mismatched state", async () => {
    const session = await createSetupApprovalSession({
      state: "T".repeat(32),
      timeoutMs: 5_000,
    });
    sessions.add(session);

    const callback = new URL(session.callbackUrl);
    callback.searchParams.set("state", "U".repeat(32));
    callback.searchParams.set("code", "OAUTH_AUTHORIZATION_CODE_1234567890");

    const response = await fetch(callback, { method: "GET" });
    expect(response.status).toBe(400);
    const html = await response.text();
    expect(html).toContain("State did not match");

    await session.close();
    await expect(session.waitForCode).rejects.toThrow("Setup approval session closed");
  });

  it("rejects non-GET callback methods", async () => {
    const session = await createSetupApprovalSession({
      state: "V".repeat(32),
      timeoutMs: 5_000,
    });
    sessions.add(session);

    const response = await fetch(session.callbackUrl, { method: "POST" });
    expect(response.status).toBe(405);
    const html = await response.text();
    expect(html).toContain("Method not allowed");

    await session.close();
    await expect(session.waitForCode).rejects.toThrow("Setup approval session closed");
  });

  it("returns 404 for non-callback paths", async () => {
    const session = await createSetupApprovalSession({
      state: "X".repeat(32),
      timeoutMs: 5_000,
    });
    sessions.add(session);

    const wrongPath = new URL(session.callbackUrl);
    wrongPath.pathname = "/not-found";
    const response = await fetch(wrongPath, { method: "GET" });
    expect(response.status).toBe(404);
    const html = await response.text();
    expect(html).toContain("Not found.");

    await session.close();
    await expect(session.waitForCode).rejects.toThrow("Setup approval session closed");
  });

  it("rejects missing/invalid authorization codes", async () => {
    const session = await createSetupApprovalSession({
      state: "Y".repeat(32),
      timeoutMs: 5_000,
    });
    sessions.add(session);

    const callback = new URL(session.callbackUrl);
    callback.searchParams.set("state", session.state);
    callback.searchParams.set("code", "bad");
    const response = await fetch(callback, { method: "GET" });
    expect(response.status).toBe(400);
    const html = await response.text();
    expect(html).toContain("Authorization code was missing or invalid.");

    await session.close();
    await expect(session.waitForCode).rejects.toThrow("Setup approval session closed");
  });

  it("renders post-auth redirect markup safely when configured", async () => {
    const session = await createSetupApprovalSession({
      state: "Z".repeat(32),
      timeoutMs: 5_000,
      postAuthRedirectUrl: "https://co.build/home?x=1&y=<unsafe>",
    });
    sessions.add(session);

    const callback = new URL(session.callbackUrl);
    const code = "OAUTH_AUTHORIZATION_CODE_1234567890";
    callback.searchParams.set("state", session.state);
    callback.searchParams.set("code", code);
    const response = await fetch(callback, { method: "GET" });
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Returning you to Cobuild...");
    expect(html).toContain("Continue to Cobuild");
    expect(html).toContain("x=1&amp;y=&lt;unsafe&gt;");
  });

  it("creates a default random state when one is not provided", async () => {
    const session = await createSetupApprovalSession({
      timeoutMs: 5_000,
    });
    sessions.add(session);
    expect(isValidSetupState(session.state)).toBe(true);
    expect(session.callbackUrl).toContain("http://127.0.0.1:");
    await session.close();
    await expect(session.waitForCode).rejects.toThrow("Setup approval session closed");
  });

  it("throws when createSetupApprovalSession receives invalid state", async () => {
    await expect(
      createSetupApprovalSession({
        state: "bad state",
      })
    ).rejects.toThrow("Invalid setup state");
  });

  it("times out if browser callback never arrives", async () => {
    const session = await createSetupApprovalSession({
      state: "W".repeat(32),
      timeoutMs: 25,
    });
    sessions.add(session);

    await expect(session.waitForCode).rejects.toThrow("Timed out waiting for browser approval");
  });
});
