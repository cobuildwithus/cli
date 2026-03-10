import { describe, expect, it } from "vitest";
import { executeCanonicalToolOnly } from "../src/commands/tool-execution.js";
import { createHarness, createToolCatalogResponse } from "./helpers.js";
import { ApiRequestError } from "../src/transport.js";

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
            text: async () => JSON.stringify(createToolCatalogResponse("get-user")),
          };
        }
        if (url.endsWith("/v1/tool-executions")) {
          const body = JSON.parse(String(init?.body));
          expect(body.name).toBe("get-user");
          expect(body.input).toEqual({ fname: "alice" });
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({ ok: true, name: body.name, output: { fid: 1, fname: "alice" } }),
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

  it("rejects malformed discovery catalog envelopes", async () => {
    const harness = createHarness({
      config: { url: "https://interface.example", token: "bbt_secret" },
      fetchResponder: async (input) => {
        const url = String(input);
        if (url.endsWith("/v1/tools")) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ data: [{ id: "cast-preview" }] }),
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
    ).rejects.toThrow('Tool catalog response includes unsupported field "data"');
  });

  it("rejects malformed canonical tool metadata in discovery responses", async () => {
    const harness = createHarness({
      config: { url: "https://interface.example", token: "bbt_secret" },
      fetchResponder: async (input) => {
        const url = String(input);
        if (url.endsWith("/v1/tools")) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                tools: [
                  {
                    name: "docs_search",
                    description: "docs",
                    inputSchema: { type: "object" },
                    scopes: [],
                    authPolicy: { requiredScopes: [], walletBinding: "none" },
                    exposure: "invalid",
                    sideEffects: "read",
                    version: "test",
                    deprecated: false,
                  },
                ],
              }),
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
    ).rejects.toThrow("exposure is invalid");
  });

  it("rejects malformed execution envelopes", async () => {
    const harness = createHarness({
      config: { url: "https://interface.example", token: "bbt_secret" },
      fetchResponder: async (input, init) => {
        const url = String(input);
        if (url.endsWith("/v1/tools")) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify(createToolCatalogResponse("docs_search")),
          };
        }
        if (url.endsWith("/v1/tool-executions")) {
          const body = JSON.parse(String(init?.body));
          expect(body.name).toBe("docs_search");
          expect(body.input).toEqual({ query: "setup" });
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
        canonicalToolNames: ["docsSearch", "docs_search"],
        input: { query: "setup" },
      })
    ).rejects.toThrow('Tool execution response includes unsupported field "execution"');
  });

  it("rejects malformed raw execution payloads", async () => {
    const harness = createHarness({
      config: { url: "https://interface.example", token: "bbt_secret" },
      fetchResponder: async (input, init) => {
        const url = String(input);
        if (url.endsWith("/v1/tools")) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ tools: [] }),
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
    ).rejects.toThrow('Tool execution response includes unsupported field "foo"');
  });

  it("rejects canonical execution responses that report a different tool name", async () => {
    const harness = createHarness({
      config: { url: "https://interface.example", token: "bbt_secret" },
      fetchResponder: async (input, init) => {
        const url = String(input);
        if (url.endsWith("/v1/tools")) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify(createToolCatalogResponse("docs_search")),
          };
        }
        if (url.endsWith("/v1/tool-executions")) {
          const body = JSON.parse(String(init?.body));
          expect(body.name).toBe("docs_search");
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({ ok: true, name: "other_tool", output: { text: "hello" } }),
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
    ).rejects.toThrow(
      'Tool execution response name mismatch: expected "docs_search", got "other_tool".'
    );
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
    ).rejects.toThrow("Canonical /v1 tool routes are unavailable.");
  });

  it("throws cutover guidance after exhausting all candidates with 404 execution errors", async () => {
    const attemptedToolNames: string[] = [];
    const harness = createHarness({
      config: { url: "https://interface.example", token: "bbt_secret" },
      fetchResponder: async (input, init) => {
        const url = String(input);
        if (url.endsWith("/v1/tools")) {
          return {
            ok: false,
            status: 404,
            text: async () => JSON.stringify({ ok: false, error: "Not found" }),
          };
        }
        if (url.endsWith("/v1/tool-executions")) {
          const body = JSON.parse(String(init?.body));
          attemptedToolNames.push(body.name);
          return {
            ok: false,
            status: 404,
            text: async () => JSON.stringify({ ok: false, error: "Not found" }),
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });

    const thrown = await executeCanonicalToolOnly(harness.deps, {
      canonicalToolNames: ["docsSearch", "file_search"],
      input: { query: "setup" },
    }).catch((error) => error);

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain("Canonical /v1 tool routes are unavailable.");
    expect((thrown as Error & { cause?: unknown }).cause).toBeInstanceOf(ApiRequestError);
    expect(attemptedToolNames).toEqual(["docsSearch", "file_search"]);
  });

  it("throws cutover guidance for route-level 404s even when discovery/execution detail text differs", async () => {
    const harness = createHarness({
      config: { url: "https://interface.example", token: "bbt_secret" },
      fetchResponder: async (input) => {
        const url = String(input);
        if (url.endsWith("/v1/tools")) {
          return {
            ok: false,
            status: 404,
            text: async () => JSON.stringify({ ok: false, error: "Cannot GET /v1/tools" }),
          };
        }
        if (url.endsWith("/v1/tool-executions")) {
          return {
            ok: false,
            status: 404,
            text: async () => JSON.stringify({ ok: false, error: "Cannot POST /v1/tool-executions" }),
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
    ).rejects.toThrow("Canonical /v1 tool routes are unavailable.");
  });

  it("throws cutover guidance when route-level 404 details include '/v1/tool-executions not found'", async () => {
    const harness = createHarness({
      config: { url: "https://interface.example", token: "bbt_secret" },
      fetchResponder: async (input) => {
        const url = String(input);
        if (url.endsWith("/v1/tools")) {
          return {
            ok: false,
            status: 404,
            text: async () => JSON.stringify({ ok: false, error: "/v1/tools not found" }),
          };
        }
        if (url.endsWith("/v1/tool-executions")) {
          return {
            ok: false,
            status: 404,
            text: async () => JSON.stringify({ ok: false, error: "/v1/tool-executions not found" }),
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
    ).rejects.toThrow("Canonical /v1 tool routes are unavailable.");
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
            text: async () => JSON.stringify({ tools: [] }),
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
            text: async () =>
              JSON.stringify({ ok: true, name: body.name, output: { fid: 7, fname: "alice" } }),
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

  it("retries with the next canonical candidate on 422 execution errors", async () => {
    const attemptedToolNames: string[] = [];
    const harness = createHarness({
      config: { url: "https://interface.example", token: "bbt_secret" },
      fetchResponder: async (input, init) => {
        const url = String(input);
        if (url.endsWith("/v1/tools")) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ tools: [] }),
          };
        }
        if (url.endsWith("/v1/tool-executions")) {
          const body = JSON.parse(String(init?.body));
          attemptedToolNames.push(body.name);
          if (body.name === "docsSearch") {
            return {
              ok: false,
              status: 422,
              text: async () => JSON.stringify({ ok: false, error: "bad input" }),
            };
          }
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({ ok: true, name: body.name, output: { fid: 7, fname: "alice" } }),
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

  it("does not retry canonical execution on 401 and preserves ApiRequestError details", async () => {
    const attemptedToolNames: string[] = [];
    const harness = createHarness({
      config: { url: "https://interface.example", token: "bbt_secret" },
      fetchResponder: async (input, init) => {
        const url = String(input);
        if (url.endsWith("/v1/tools")) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ tools: [] }),
          };
        }
        if (url.endsWith("/v1/tool-executions")) {
          const body = JSON.parse(String(init?.body));
          attemptedToolNames.push(body.name);
          return {
            ok: false,
            status: 401,
            text: async () => JSON.stringify({ ok: false, error: "Unauthorized" }),
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });

    const thrown = await executeCanonicalToolOnly(harness.deps, {
      canonicalToolNames: ["docsSearch", "file_search"],
      input: { query: "setup" },
    }).catch((error) => error);

    expect(thrown).toBeInstanceOf(ApiRequestError);
    expect(thrown).toMatchObject({
      status: 401,
      detail: "Unauthorized",
      message: "Request failed (status 401): Unauthorized",
    });
    expect(attemptedToolNames).toEqual(["docsSearch"]);
  });

  it("returns last retryable ApiRequestError when discovery is 404 but execution includes non-404 retryable failures", async () => {
    const harness = createHarness({
      config: { url: "https://interface.example", token: "bbt_secret" },
      fetchResponder: async (input, init) => {
        const url = String(input);
        if (url.endsWith("/v1/tools")) {
          return {
            ok: false,
            status: 404,
            text: async () => JSON.stringify({ ok: false, error: "Not found" }),
          };
        }
        if (url.endsWith("/v1/tool-executions")) {
          const body = JSON.parse(String(init?.body));
          if (body.name === "docsSearch") {
            return {
              ok: false,
              status: 404,
              text: async () => JSON.stringify({ ok: false, error: "Not found" }),
            };
          }
          return {
            ok: false,
            status: 400,
            text: async () => JSON.stringify({ ok: false, error: "invalid input" }),
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });

    const thrown = await executeCanonicalToolOnly(harness.deps, {
      canonicalToolNames: ["docsSearch", "file_search"],
      input: { query: "setup" },
    }).catch((error) => error);

    expect(thrown).toBeInstanceOf(ApiRequestError);
    expect(thrown).toMatchObject({
      status: 400,
      detail: "invalid input",
      message: "Request failed (status 400): invalid input",
    });
  });

  it("returns last 404 ApiRequestError when discovery and execution 404 details do not match", async () => {
    const harness = createHarness({
      config: { url: "https://interface.example", token: "bbt_secret" },
      fetchResponder: async (input, init) => {
        const url = String(input);
        if (url.endsWith("/v1/tools")) {
          return {
            ok: false,
            status: 404,
            text: async () => JSON.stringify({ ok: false, error: "Not found" }),
          };
        }
        if (url.endsWith("/v1/tool-executions")) {
          const body = JSON.parse(String(init?.body));
          if (body.name === "docsSearch") {
            return {
              ok: false,
              status: 404,
              text: async () => JSON.stringify({ ok: false, error: "Tool not found" }),
            };
          }
          return {
            ok: false,
            status: 404,
            text: async () => JSON.stringify({ ok: false, error: "Tool not found" }),
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });

    const thrown = await executeCanonicalToolOnly(harness.deps, {
      canonicalToolNames: ["docsSearch", "file_search"],
      input: { query: "setup" },
    }).catch((error) => error);

    expect(thrown).toBeInstanceOf(ApiRequestError);
    expect(thrown).toMatchObject({
      status: 404,
      detail: "Tool not found",
      message: "Request failed (status 404): Tool not found",
    });
  });

  it("treats unknown/invalid tool-name 404s as candidate mismatch instead of route-unavailable", async () => {
    const attemptedToolNames: string[] = [];
    const harness = createHarness({
      config: { url: "https://interface.example", token: "bbt_secret" },
      fetchResponder: async (input, init) => {
        const url = String(input);
        if (url.endsWith("/v1/tools")) {
          return {
            ok: false,
            status: 404,
            text: async () => JSON.stringify({ ok: false, error: "Cannot GET /v1/tools" }),
          };
        }
        if (url.endsWith("/v1/tool-executions")) {
          const body = JSON.parse(String(init?.body));
          attemptedToolNames.push(body.name);
          if (body.name === "docsSearch") {
            return {
              ok: false,
              status: 404,
              text: async () => JSON.stringify({ ok: false, error: "Unknown tool: docsSearch" }),
            };
          }
          return {
            ok: false,
            status: 404,
            text: async () => JSON.stringify({ ok: false, error: "Invalid tool name: file_search" }),
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });

    const thrown = await executeCanonicalToolOnly(harness.deps, {
      canonicalToolNames: ["docsSearch", "file_search"],
      input: { query: "setup" },
    }).catch((error) => error);

    expect(thrown).toBeInstanceOf(ApiRequestError);
    expect(thrown).toMatchObject({
      status: 404,
      detail: "Invalid tool name: file_search",
      message: "Request failed (status 404): Invalid tool name: file_search",
    });
    expect(attemptedToolNames).toEqual(["docsSearch", "file_search"]);
  });
});
