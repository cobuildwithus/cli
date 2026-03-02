import { describe, expect, it } from "vitest";
import { executeCanonicalToolOnly } from "../src/commands/tool-execution.js";
import { createHarness } from "./helpers.js";

describe("tool execution helper", () => {
  it("rejects empty canonical tool names", async () => {
    const harness = createHarness({
      config: { url: "https://interface.example", token: "bbt_secret" },
    });

    await expect(
      executeCanonicalToolOnly(harness.deps, {
        canonicalToolNames: [" ", ""],
        input: {},
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
          expect(body.name).toBe("get-user");
          expect(body.input).toEqual({ fname: "alice" });
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
      executeCanonicalToolOnly(harness.deps, {
        canonicalToolNames: ["getUser", "get-user"],
        input: { fname: "alice" },
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
          expect(body.name).toBe("cast-preview");
          expect(body.input).toEqual({ text: "hello" });
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
      executeCanonicalToolOnly(harness.deps, {
        canonicalToolNames: ["castPreview", "cast-preview"],
        input: { text: "hello" },
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
          expect(body.name).toBe("docs_search");
          expect(body.input).toEqual({ query: "setup" });
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
      executeCanonicalToolOnly(harness.deps, {
        canonicalToolNames: ["docsSearch", "docs_search"],
        input: { query: "setup" },
      })
    ).resolves.toEqual([{ id: "a" }]);
  });

  it("returns raw canonical payload when there is no known execution result key", async () => {
    const harness = createHarness({
      config: { url: "https://interface.example", token: "bbt_secret" },
      fetchResponder: async (input, init) => {
        const url = String(input);
        if (url.endsWith("/v1/tools")) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify([]),
          };
        }
        if (url.endsWith("/v1/tool-executions")) {
          const body = JSON.parse(String(init?.body));
          expect(body).toEqual({
            name: "getUser",
            input: { fname: "alice" },
          });
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
      executeCanonicalToolOnly(harness.deps, {
        canonicalToolNames: ["getUser"],
        input: { fname: "alice" },
      })
    ).resolves.toEqual({ foo: "bar" });
  });

  it("throws when canonical execution routes are unavailable", async () => {
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
        throw new Error(`Unexpected URL: ${url}`);
      },
    });

    await expect(
      executeCanonicalToolOnly(harness.deps, {
        canonicalToolNames: ["docsSearch"],
        input: { query: "setup" },
      })
    ).rejects.toThrow("Request failed (status 404): Not found");
  });

  it("throws non-retryable discovery errors and skips canonical execution", async () => {
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
      executeCanonicalToolOnly(harness.deps, {
        canonicalToolNames: ["getUser"],
        input: { fname: "alice" },
      })
    ).rejects.toThrow("Request failed (status 500): boom");

    expect(harness.fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries with the next canonical candidate on retryable execution errors", async () => {
    const attemptedToolNames: string[] = [];
    const harness = createHarness({
      config: { url: "https://interface.example", token: "bbt_secret" },
      fetchResponder: async (input, init) => {
        const url = String(input);
        if (url.endsWith("/v1/tools")) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify([]),
          };
        }
        if (url.endsWith("/v1/tool-executions")) {
          const body = JSON.parse(String(init?.body));
          attemptedToolNames.push(body.name);
          if (body.name === "docsSearch") {
            return {
              ok: false,
              status: 404,
              text: async () => JSON.stringify({ ok: false, error: "Not found" }),
            };
          }
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ result: { fid: 7, fname: "alice" } }),
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });

    await expect(
      executeCanonicalToolOnly(harness.deps, {
        canonicalToolNames: ["docsSearch", "file_search"],
        input: { query: "setup" },
      })
    ).resolves.toEqual({ fid: 7, fname: "alice" });

    expect(attemptedToolNames).toEqual(["docsSearch", "file_search"]);
  });

  it("throws non-retryable canonical execution errors without trying additional candidates", async () => {
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
      executeCanonicalToolOnly(harness.deps, {
        canonicalToolNames: ["getUser", "get-user"],
        input: { fname: "alice" },
      })
    ).rejects.toThrow("Request failed (status 500): boom");

    expect(
      harness.fetchMock.mock.calls.filter(([input]) =>
        String(input).endsWith("/v1/tool-executions")
      )
    ).toHaveLength(1);
  });
});
