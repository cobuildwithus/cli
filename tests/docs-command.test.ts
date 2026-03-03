import { describe, expect, it } from "vitest";
import { executeDocsCommand } from "../src/commands/docs.js";
import { createHarness } from "./helpers.js";

function createJsonResponder(body: unknown, status = 200) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  });
}

describe("docs command", () => {
  it("rejects missing queries", async () => {
    const harness = createHarness();
    await expect(executeDocsCommand({}, harness.deps)).rejects.toThrow(
      "Usage: cli docs <query> [--limit <n>]"
    );
  });

  it("rejects out-of-range limits", async () => {
    const harness = createHarness();
    await expect(executeDocsCommand({ query: "setup", limit: "0" }, harness.deps)).rejects.toThrow(
      "--limit must be between 1 and 20"
    );
  });

  it("normalizes canonical data arrays", async () => {
    const harness = createHarness({
      config: {
        url: "https://interface.example",
        token: "bbt_secret",
      },
      fetchResponder: async (input) => {
        const url = String(input);
        if (url.endsWith("/v1/tools")) {
          return await createJsonResponder({ tools: [{ name: "docsSearch" }] })();
        }
        if (url.endsWith("/v1/tool-executions")) {
          return await createJsonResponder({ data: [{ filename: "one.mdx" }] })();
        }
        return await createJsonResponder({ ok: false, error: "Unexpected URL" }, 500)();
      },
    });

    await expect(executeDocsCommand({ query: "setup" }, harness.deps)).resolves.toEqual({
      query: "setup",
      count: 1,
      results: [{ filename: "one.mdx" }],
    });
  });

  it("normalizes canonical output arrays", async () => {
    const harness = createHarness({
      config: {
        url: "https://interface.example",
        token: "bbt_secret",
      },
      fetchResponder: async (input) => {
        const url = String(input);
        if (url.endsWith("/v1/tools")) {
          return await createJsonResponder({ tools: [{ name: "docsSearch" }] })();
        }
        if (url.endsWith("/v1/tool-executions")) {
          return await createJsonResponder({ output: [{ filename: "one.mdx" }] })();
        }
        return await createJsonResponder({ ok: false, error: "Unexpected URL" }, 500)();
      },
    });

    await expect(executeDocsCommand({ query: "setup" }, harness.deps)).resolves.toEqual({
      query: "setup",
      count: 1,
      results: [{ filename: "one.mdx" }],
    });
  });
});
