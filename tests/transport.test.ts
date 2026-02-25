import { describe, expect, it } from "vitest";
import { apiPost, toEndpoint } from "../src/transport.js";
import { createHarness } from "./helpers.js";

describe("transport", () => {
  it("normalizes endpoint slashes", () => {
    expect(toEndpoint("https://api.example", "/api/buildbot/wallet").toString()).toBe(
      "https://api.example/api/buildbot/wallet"
    );
    expect(toEndpoint("https://api.example/", "api/buildbot/wallet").toString()).toBe(
      "https://api.example/api/buildbot/wallet"
    );
  });

  it("normalizes padded base URLs before building endpoints", () => {
    expect(toEndpoint(" https://api.example ", "/api/buildbot/wallet").toString()).toBe(
      "https://api.example/api/buildbot/wallet"
    );
  });

  it("allows loopback http URLs and rejects non-loopback http URLs", () => {
    expect(toEndpoint("http://localhost:3000", "/api/buildbot/wallet").toString()).toBe(
      "http://localhost:3000/api/buildbot/wallet"
    );
    expect(toEndpoint("http://127.0.0.1:8080", "/api/buildbot/wallet").toString()).toBe(
      "http://127.0.0.1:8080/api/buildbot/wallet"
    );
    expect(toEndpoint("http://[::1]:8080", "/api/buildbot/wallet").toString()).toBe(
      "http://[::1]:8080/api/buildbot/wallet"
    );
    expect(() => toEndpoint("http://api.example", "/api/buildbot/wallet")).toThrow(
      "API base URL must use https"
    );
    expect(() => toEndpoint("http://127.0.0.2:8080", "/api/buildbot/wallet")).toThrow(
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

    const payload = await apiPost(harness.deps, "/api/buildbot/wallet", { hello: "world" });
    expect(payload).toEqual({ ok: true, wallet: "0xabc" });

    expect(harness.fetchMock).toHaveBeenCalledTimes(1);
    const [input, init] = harness.fetchMock.mock.calls[0];
    expect(String(input)).toBe("https://api.example/api/buildbot/wallet");
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
      apiPost(harness.deps, "/api/buildbot/wallet", {}, { headers: { authorization: "Bearer other" } })
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

    await expect(apiPost(harness.deps, "/api/buildbot/wallet", {}, { timeoutMs: 0 })).rejects.toThrow(
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

    await expect(apiPost(harness.deps, "/api/buildbot/wallet", {}, { timeoutMs: 5 })).rejects.toThrow(
      "Request timed out after 5ms"
    );
  });

  it("routes docs endpoint requests through the interface URL", async () => {
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

    await apiPost(harness.deps, "/api/docs/search", { query: "setup" });

    const [input] = harness.fetchMock.mock.calls[0];
    expect(String(input)).toBe("https://interface.example/api/docs/search");
  });

  it("ignores deprecated chatApiUrl values and still routes through interface URL", async () => {
    const harness = createHarness({
      rawConfig: JSON.stringify(
        {
          url: "https://interface.example",
          chatApiUrl: "https://chat.example",
          token: "bbt_secret",
        },
        null,
        2
      ),
      fetchResponder: async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true }),
      }),
    });

    await apiPost(harness.deps, "/api/docs/search", { query: "setup" });

    const [input] = harness.fetchMock.mock.calls[0];
    expect(String(input)).toBe("https://interface.example/api/docs/search");
  });

  it("rejects insecure transport before sending bearer token", async () => {
    const harness = createHarness({
      config: {
        url: "http://api.example",
        token: "bbt_secret",
      },
    });

    await expect(apiPost(harness.deps, "/api/buildbot/wallet", {})).rejects.toThrow(
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

    await expect(apiPost(harness.deps, "/api/buildbot/wallet", {})).rejects.toThrow(
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

    await expect(apiPost(harness.deps, "/api/buildbot/wallet", {})).rejects.toThrow(
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

    await expect(apiPost(harness.deps, "/api/buildbot/wallet", {})).rejects.toThrow(
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

    await expect(apiPost(harness.deps, "/api/buildbot/wallet", {})).rejects.toThrow(
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

    await expect(apiPost(harness.deps, "/api/buildbot/wallet", {})).rejects.toThrow(
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
      await apiPost(harness.deps, "/api/buildbot/wallet", {});
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

    await expect(apiPost(harness.deps, "/api/buildbot/wallet", {})).resolves.toEqual(["ok"]);
  });
});
