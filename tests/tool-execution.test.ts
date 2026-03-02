import { describe, expect, it } from "vitest";
import { executeToolWithLegacyFallback, shouldFallbackToLegacyToolRoute } from "../src/commands/tool-execution.js";
import { ApiRequestError } from "../src/transport.js";
import { createHarness } from "./helpers.js";

describe("tool execution helper", () => {
  it("classifies fallback-eligible request errors", () => {
    expect(shouldFallbackToLegacyToolRoute(new Error("boom"))).toBe(false);
    expect(shouldFallbackToLegacyToolRoute(new ApiRequestError(404, "Not found"))).toBe(true);
    expect(shouldFallbackToLegacyToolRoute(new ApiRequestError(500, "boom"))).toBe(false);
  });

  it("rejects empty canonical tool names", async () => {
    const harness = createHarness({
      config: { url: "https://interface.example", token: "bbt_secret" },
    });

    await expect(
      executeToolWithLegacyFallback(harness.deps, {
        canonicalToolNames: [" ", ""],
        input: {},
        legacyPath: "/api/legacy",
        legacyBody: {},
      })
    ).rejects.toThrow("At least one canonical tool name must be configured.");
  });

  it("prefers discovered matching tool names from tools catalog", async () => {
    const harness = createHarness({
      config: { url: "https://interface.example", token: "bbt_secret" },
      fetchResponder: async (input, init) => {
        const url = String(input);
        if (url.endsWith("/v1/tools")) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ tools: [{ name: "get-user" }] }),
          };
        }
        if (url.endsWith("/v1/tool-executions")) {
          const body = JSON.parse(String(init?.body));
          expect(body.toolName).toBe("get-user");
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ result: { fid: 1, fname: "alice" } }),
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });

    await expect(
      executeToolWithLegacyFallback(harness.deps, {
        canonicalToolNames: ["getUser", "get-user"],
        input: { fname: "alice" },
        legacyPath: "/api/buildbot/tools/get-user",
        legacyBody: { fname: "alice" },
      })
    ).resolves.toEqual({ fid: 1, fname: "alice" });
  });

  it("supports discovery catalog data/id entries and nested execution envelopes", async () => {
    const harness = createHarness({
      config: { url: "https://interface.example", token: "bbt_secret" },
      fetchResponder: async (input, init) => {
        const url = String(input);
        if (url.endsWith("/v1/tools")) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ data: [{ id: "cast-preview" }] }),
          };
        }
        if (url.endsWith("/v1/tool-executions")) {
          const body = JSON.parse(String(init?.body));
          expect(body.toolName).toBe("cast-preview");
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ execution: { output: { text: "hello" } } }),
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });

    await expect(
      executeToolWithLegacyFallback(harness.deps, {
        canonicalToolNames: ["castPreview", "cast-preview"],
        input: { text: "hello" },
        legacyPath: "/api/buildbot/tools/cast-preview",
        legacyBody: { text: "hello" },
      })
    ).resolves.toEqual({ text: "hello" });
  });

  it("supports catalog results entries and array execution payloads", async () => {
    const harness = createHarness({
      config: { url: "https://interface.example", token: "bbt_secret" },
      fetchResponder: async (input, init) => {
        const url = String(input);
        if (url.endsWith("/v1/tools")) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ results: [{ toolName: "docs_search" }] }),
          };
        }
        if (url.endsWith("/v1/tool-executions")) {
          const body = JSON.parse(String(init?.body));
          expect(body.toolName).toBe("docs_search");
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify([{ id: "a" }]),
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });

    await expect(
      executeToolWithLegacyFallback(harness.deps, {
        canonicalToolNames: ["docsSearch", "docs_search"],
        input: { query: "setup" },
        legacyPath: "/api/docs/search",
        legacyBody: { query: "setup" },
      })
    ).resolves.toEqual([{ id: "a" }]);
  });

  it("returns raw canonical payload when there is no known execution result key", async () => {
    const harness = createHarness({
      config: { url: "https://interface.example", token: "bbt_secret" },
      fetchResponder: async (input) => {
        const url = String(input);
        if (url.endsWith("/v1/tools")) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify([]),
          };
        }
        if (url.endsWith("/v1/tool-executions")) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ foo: "bar" }),
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });

    await expect(
      executeToolWithLegacyFallback(harness.deps, {
        canonicalToolNames: ["getUser"],
        input: { fname: "alice" },
        legacyPath: "/api/buildbot/tools/get-user",
        legacyBody: { fname: "alice" },
      })
    ).resolves.toEqual({ foo: "bar" });
  });

  it("falls back to legacy route when canonical endpoints are unavailable", async () => {
    const harness = createHarness({
      config: { url: "https://interface.example", token: "bbt_secret" },
      fetchResponder: async (input) => {
        const url = String(input);
        if (url.endsWith("/v1/tools") || url.endsWith("/v1/tool-executions")) {
          return {
            ok: false,
            status: 404,
            text: async () => JSON.stringify({ ok: false, error: "Not found" }),
          };
        }
        if (url.endsWith("/api/docs/search")) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({ query: "setup", count: 1, results: [{ filename: "docs.mdx" }] }),
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });

    await expect(
      executeToolWithLegacyFallback(harness.deps, {
        canonicalToolNames: ["docsSearch"],
        input: { query: "setup" },
        legacyPath: "/api/docs/search",
        legacyBody: { query: "setup" },
      })
    ).resolves.toEqual({ query: "setup", count: 1, results: [{ filename: "docs.mdx" }] });
  });

  it("throws non-fallback discovery errors and skips canonical execution", async () => {
    const harness = createHarness({
      config: { url: "https://interface.example", token: "bbt_secret" },
      fetchResponder: async (input) => {
        const url = String(input);
        if (url.endsWith("/v1/tools")) {
          return {
            ok: false,
            status: 500,
            text: async () => JSON.stringify({ ok: false, error: "boom" }),
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });

    await expect(
      executeToolWithLegacyFallback(harness.deps, {
        canonicalToolNames: ["getUser"],
        input: { fname: "alice" },
        legacyPath: "/api/buildbot/tools/get-user",
        legacyBody: { fname: "alice" },
      })
    ).rejects.toThrow("Request failed (status 500): boom");

    expect(harness.fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws non-fallback canonical execution errors without legacy fallback", async () => {
    const harness = createHarness({
      config: { url: "https://interface.example", token: "bbt_secret" },
      fetchResponder: async (input) => {
        const url = String(input);
        if (url.endsWith("/v1/tools")) {
          return {
            ok: false,
            status: 404,
            text: async () => JSON.stringify({ ok: false, error: "Not found" }),
          };
        }
        if (url.endsWith("/v1/tool-executions")) {
          return {
            ok: false,
            status: 500,
            text: async () => JSON.stringify({ ok: false, error: "boom" }),
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });

    await expect(
      executeToolWithLegacyFallback(harness.deps, {
        canonicalToolNames: ["getUser"],
        input: { fname: "alice" },
        legacyPath: "/api/buildbot/tools/get-user",
        legacyBody: { fname: "alice" },
      })
    ).rejects.toThrow("Request failed (status 500): boom");

    expect(
      harness.fetchMock.mock.calls.some(([input]) =>
        String(input).endsWith("/api/buildbot/tools/get-user")
      )
    ).toBe(false);
  });
});
