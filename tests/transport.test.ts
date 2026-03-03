import { describe, expect, it } from "vitest";
import { apiGet, apiPost, toEndpoint } from "../src/transport.js";
import { createHarness } from "./helpers.js";

describe("transport", () => {
  it("normalizes endpoint slashes", () => {
    expect(toEndpoint("https://api.example", "/api/cli/wallet").toString()).toBe(
      "https://api.example/api/cli/wallet"
    );
    expect(toEndpoint("https://api.example/", "api/cli/wallet").toString()).toBe(
      "https://api.example/api/cli/wallet"
    );
  });

  it("normalizes padded base URLs before building endpoints", () => {
    expect(toEndpoint(" https://api.example ", "/api/cli/wallet").toString()).toBe(
      "https://api.example/api/cli/wallet"
    );
  });

  it("allows loopback http URLs and rejects non-loopback http URLs", () => {
    expect(toEndpoint("http://localhost:3000", "/api/cli/wallet").toString()).toBe(
      "http://localhost:3000/api/cli/wallet"
    );
    expect(toEndpoint("http://127.0.0.1:8080", "/api/cli/wallet").toString()).toBe(
      "http://127.0.0.1:8080/api/cli/wallet"
    );
    expect(toEndpoint("http://[::1]:8080", "/api/cli/wallet").toString()).toBe(
      "http://[::1]:8080/api/cli/wallet"
    );
    expect(() => toEndpoint("http://api.example", "/api/cli/wallet")).toThrow(
      "API base URL must use https"
    );
    expect(() => toEndpoint("http://127.0.0.2:8080", "/api/cli/wallet")).toThrow(
      "API base URL must use https"
    );
  });

  it("posts JSON and returns parsed payload", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
      fetchResponder: async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true, wallet: "0xabc" }),
      }),
    });

    const payload = await apiPost(harness.deps, "/api/cli/wallet", { hello: "world" });
    expect(payload).toEqual({ ok: true, wallet: "0xabc" });

    expect(harness.fetchMock).toHaveBeenCalledTimes(1);
    const [input, init] = harness.fetchMock.mock.calls[0];
    expect(String(input)).toBe("https://api.example/api/cli/wallet");
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer bbt_secret",
      },
      body: JSON.stringify({ hello: "world" }),
    });
    expect(init?.signal).toBeDefined();
  });

  it("rejects custom headers that override reserved auth/content headers", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
    });

    await expect(
      apiPost(harness.deps, "/api/cli/wallet", {}, { headers: { authorization: "Bearer other" } })
    ).rejects.toThrow("Custom headers must not override reserved header: authorization");
    expect(harness.fetchMock).not.toHaveBeenCalled();
  });

  it("rejects invalid timeout values before dispatch", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
    });

    await expect(apiPost(harness.deps, "/api/cli/wallet", {}, { timeoutMs: 0 })).rejects.toThrow(
      "Request timeout must be a positive number of milliseconds."
    );
    expect(harness.fetchMock).not.toHaveBeenCalled();
  });

  it("times out hung requests", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
      fetchResponder: async (_input, init) =>
        await new Promise((_, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
          });
        }),
    });

    await expect(apiPost(harness.deps, "/api/cli/wallet", {}, { timeoutMs: 5 })).rejects.toThrow(
      "Request timed out after 5ms"
    );
  });

  it("routes canonical tool execution requests through chatApiUrl when configured", async () => {
    const harness = createHarness({
      config: {
        url: "https://interface.example",
        chatApiUrl: "https://chat.example",
        token: "bbt_secret",
      },
      fetchResponder: async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true }),
      }),
    });

    await apiPost(harness.deps, "/v1/tool-executions", {
      name: "getUser",
      input: { fname: "alice" },
    });

    const [input, init] = harness.fetchMock.mock.calls[0];
    expect(String(input)).toBe("https://chat.example/v1/tool-executions");
    expect(init).toMatchObject({ method: "POST" });
  });

  it("routes canonical discovery through interface URL when chatApiUrl is absent", async () => {
    const harness = createHarness({
      config: {
        url: "https://interface.example",
        token: "bbt_secret",
      },
      fetchResponder: async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true }),
      }),
    });

    await apiGet(harness.deps, "/v1/tools");

    const [input, init] = harness.fetchMock.mock.calls[0];
    expect(String(input)).toBe("https://interface.example/v1/tools");
    expect(init).toMatchObject({ method: "GET" });
  });

  it("keeps interface routing for non-v1 paths even when chatApiUrl is configured", async () => {
    const harness = createHarness({
      config: {
        url: "https://interface.example",
        chatApiUrl: "https://chat.example",
        token: "bbt_secret",
      },
      fetchResponder: async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true }),
      }),
    });

    await apiPost(harness.deps, "/api/cli/wallet", { agentKey: "default" });

    const [input] = harness.fetchMock.mock.calls[0];
    expect(String(input)).toBe("https://interface.example/api/cli/wallet");
  });

  it("rejects insecure chatApiUrl for /v1 paths before sending bearer token", async () => {
    const harness = createHarness({
      config: {
        url: "https://interface.example",
        chatApiUrl: "http://chat.example",
        token: "bbt_secret",
      },
    });

    await expect(apiGet(harness.deps, "/v1/tools")).rejects.toThrow("API base URL must use https");
    expect(harness.fetchMock).not.toHaveBeenCalled();
  });

  it("keeps non-v1 routing on interface URL even when chatApiUrl is invalid", async () => {
    const harness = createHarness({
      config: {
        url: "https://interface.example",
        chatApiUrl: "http://chat.example",
        token: "bbt_secret",
      },
      fetchResponder: async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true }),
      }),
    });

    await apiPost(harness.deps, "/api/cli/wallet", { agentKey: "default" });

    const [input] = harness.fetchMock.mock.calls[0];
    expect(String(input)).toBe("https://interface.example/api/cli/wallet");
  });

  it("rejects insecure transport before sending bearer token", async () => {
    const harness = createHarness({
      config: {
        url: "http://api.example",
        token: "bbt_secret",
      },
    });

    await expect(apiPost(harness.deps, "/api/cli/wallet", {})).rejects.toThrow(
      "API base URL must use https"
    );
    expect(harness.fetchMock).not.toHaveBeenCalled();
  });

  it("rejects URL credentials before sending bearer token", async () => {
    const harness = createHarness({
      config: {
        url: "https://user:pass@api.example",
        token: "bbt_secret",
      },
    });

    await expect(apiPost(harness.deps, "/api/cli/wallet", {})).rejects.toThrow(
      "must not include username or password"
    );
    expect(harness.fetchMock).not.toHaveBeenCalled();
  });

  it("rejects invalid API base URLs before sending bearer token", async () => {
    const harness = createHarness({
      config: {
        url: "api.example",
        token: "bbt_secret",
      },
    });

    await expect(apiPost(harness.deps, "/api/cli/wallet", {})).rejects.toThrow(
      "API base URL is invalid. Use an absolute https URL."
    );
    expect(harness.fetchMock).not.toHaveBeenCalled();
  });

  it("throws normalized error for non-json failure payload", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
      fetchResponder: async () => ({
        ok: false,
        status: 500,
        text: async () => "backend down",
      }),
    });

    await expect(apiPost(harness.deps, "/api/cli/wallet", {})).rejects.toThrow(
      "Request failed (status 500): backend down"
    );
  });

  it("throws error from ok:false payload", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
      fetchResponder: async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: false, error: "denied" }),
      }),
    });

    await expect(apiPost(harness.deps, "/api/cli/wallet", {})).rejects.toThrow(
      "Request failed (status 200): denied"
    );
  });

  it("falls back to status when payload has no error string", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
      fetchResponder: async () => ({
        ok: false,
        status: 418,
        text: async () => JSON.stringify({ ok: false }),
      }),
    });

    await expect(apiPost(harness.deps, "/api/cli/wallet", {})).rejects.toThrow(
      "Request failed (status 418)"
    );
  });

  it("bounds and sanitizes server-controlled error text", async () => {
    const rawError = `\u0000backend\tfailed\n${"x".repeat(400)}`;
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
      fetchResponder: async () => ({
        ok: false,
        status: 502,
        text: async () => rawError,
      }),
    });

    let message = "";
    try {
      await apiPost(harness.deps, "/api/cli/wallet", {});
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message.startsWith("Request failed (status 502): ")).toBe(true);
    expect(message).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
    expect(message.endsWith("...")).toBe(true);
    expect(message.length).toBeLessThanOrEqual("Request failed (status 502): ".length + 240);
  });

  it("passes through non-object JSON payloads", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
      fetchResponder: async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(["ok"]),
      }),
    });

    await expect(apiPost(harness.deps, "/api/cli/wallet", {})).resolves.toEqual(["ok"]);
  });

  it("retries refresh once with latest stored token after invalid_grant", async () => {
    const initialConfig = {
      url: "https://interface.example",
      chatApiUrl: "https://chat.example",
      token: "rfr_initial",
    } as const;

    let tokenRequestCount = 0;
    const harness = createHarness({
      config: initialConfig,
      fetchResponder: async (input, init) => {
        const url = String(input);
        if (url === "https://chat.example/oauth/token") {
          tokenRequestCount += 1;
          const payload = JSON.parse(String(init?.body)) as { refresh_token?: string };
          if (tokenRequestCount === 1) {
            expect(payload.refresh_token).toBe("rfr_initial");
            harness.files.set(
              harness.configFile,
              JSON.stringify(
                {
                  ...initialConfig,
                  token: "rfr_rotated_elsewhere",
                },
                null,
                2
              )
            );
            return {
              ok: false,
              status: 400,
              text: async () =>
                JSON.stringify({
                  error: "invalid_grant",
                  error_description: "Refresh token is invalid or expired",
                }),
            };
          }

          expect(payload.refresh_token).toBe("rfr_rotated_elsewhere");
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                access_token: "access_after_retry",
                refresh_token: "rfr_rotated_elsewhere",
                expires_in: 600,
                scope: "tools:read offline_access",
                session_id: "42",
              }),
          };
        }

        expect(url).toBe("https://chat.example/v1/tools");
        expect(init?.headers?.authorization).toBe("Bearer access_after_retry");
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ ok: true }),
        };
      },
    });

    await expect(apiGet(harness.deps, "/v1/tools")).resolves.toEqual({ ok: true });
    expect(tokenRequestCount).toBe(2);
  });
});
