import { describe, expect, it } from "vitest";
import { handleToolsCommand } from "../src/commands/tools.js";
import { createHarness } from "./helpers.js";

function parseLastJsonOutput(outputs: string[]): unknown {
  return JSON.parse(outputs.at(-1) ?? "null");
}

describe("tools branch coverage", () => {
  it("rejects unknown tools subcommands", async () => {
    const harness = createHarness();
    await expect(handleToolsCommand(["unknown"], harness.deps)).rejects.toThrow(
      "Unknown tools subcommand: unknown"
    );
  });

  it("preserves explicit ok boolean responses for treasury stats", async () => {
    const harness = createHarness({
      config: {
        url: "https://interface.example",
        token: "bbt_secret",
      },
      fetchResponder: async (input) => {
        const url = String(input);
        if (url.endsWith("/v1/tool-executions")) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ ok: true, data: { stale: true } }),
          };
        }
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ tools: [{ name: "get-treasury-stats" }] }),
        };
      },
    });

    await handleToolsCommand(["get-treasury-stats"], harness.deps);
    expect(parseLastJsonOutput(harness.outputs)).toEqual({
      ok: true,
      data: { stale: true },
    });
  });

  it("normalizes get-user responses when canonical payload nests result", async () => {
    const withOkHarness = createHarness({
      config: {
        url: "https://interface.example",
        token: "bbt_secret",
      },
      fetchResponder: async (input) => {
        const url = String(input);
        if (url.endsWith("/v1/tool-executions")) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ result: { ok: false, result: { fid: 1 } } }),
          };
        }
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ tools: [{ name: "getUser" }] }),
        };
      },
    });

    await handleToolsCommand(["get-user", "alice"], withOkHarness.deps);
    expect(parseLastJsonOutput(withOkHarness.outputs)).toEqual({
      ok: false,
      result: { fid: 1 },
    });

    const withoutOkHarness = createHarness({
      config: {
        url: "https://interface.example",
        token: "bbt_secret",
      },
      fetchResponder: async (input) => {
        const url = String(input);
        if (url.endsWith("/v1/tool-executions")) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ result: { result: { fid: 2 } } }),
          };
        }
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ tools: [{ name: "getUser" }] }),
        };
      },
    });

    await handleToolsCommand(["get-user", "bob"], withoutOkHarness.deps);
    expect(parseLastJsonOutput(withoutOkHarness.outputs)).toEqual({
      ok: true,
      result: { fid: 2 },
    });
  });

  it("normalizes get-cast and cast-preview fallbacks", async () => {
    const getCastHarness = createHarness({
      config: {
        url: "https://interface.example",
        token: "bbt_secret",
      },
      fetchResponder: async (input) => {
        const url = String(input);
        if (url.endsWith("/v1/tool-executions")) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ result: { foo: "bar" } }),
          };
        }
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ tools: [{ name: "getCast" }] }),
        };
      },
    });

    await handleToolsCommand(["get-cast", "0xabc"], getCastHarness.deps);
    expect(parseLastJsonOutput(getCastHarness.outputs)).toEqual({
      ok: true,
      cast: { foo: "bar" },
    });

    const castPreviewHarness = createHarness({
      config: {
        url: "https://interface.example",
        token: "bbt_secret",
      },
      fetchResponder: async (input) => {
        const url = String(input);
        if (url.endsWith("/v1/tool-executions")) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ result: { ok: true, cast: { text: "hi" } } }),
          };
        }
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ tools: [{ name: "castPreview" }] }),
        };
      },
    });

    await handleToolsCommand(["cast-preview", "--text", "hi"], castPreviewHarness.deps);
    expect(parseLastJsonOutput(castPreviewHarness.outputs)).toEqual({
      ok: true,
      cast: { text: "hi" },
    });
  });

  it("normalizes treasury stats payloads with data but no ok field", async () => {
    const harness = createHarness({
      config: {
        url: "https://interface.example",
        token: "bbt_secret",
      },
      fetchResponder: async (input) => {
        const url = String(input);
        if (url.endsWith("/v1/tool-executions")) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ result: { data: { snapshots: 1 } } }),
          };
        }
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ tools: [{ name: "get-treasury-stats" }] }),
        };
      },
    });

    await handleToolsCommand(["get-treasury-stats"], harness.deps);
    expect(parseLastJsonOutput(harness.outputs)).toEqual({
      ok: true,
      data: { snapshots: 1 },
    });
  });

  it("normalizes treasury stats payloads without data field", async () => {
    const harness = createHarness({
      config: {
        url: "https://interface.example",
        token: "bbt_secret",
      },
      fetchResponder: async (input) => {
        const url = String(input);
        if (url.endsWith("/v1/tool-executions")) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ foo: "bar" }),
          };
        }
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ tools: [{ name: "get-treasury-stats" }] }),
        };
      },
    });

    await handleToolsCommand(["get-treasury-stats"], harness.deps);
    expect(parseLastJsonOutput(harness.outputs)).toEqual({
      ok: true,
      data: { foo: "bar" },
    });
  });
});
