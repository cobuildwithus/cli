import { describe, expect, it } from "vitest";
import {
  executeToolsCastPreviewCommand,
  executeToolsGetCastCommand,
  executeToolsGetUserCommand,
  executeToolsTreasuryStatsCommand,
  handleToolsCommand,
} from "../src/commands/tools.js";
import { createHarness } from "./helpers.js";

function parseLastJsonOutput(outputs: string[]): unknown {
  return JSON.parse(outputs.at(-1) ?? "null");
}

describe("tools branch coverage", () => {
  it("legacy handler rejects unknown subcommands", async () => {
    const harness = createHarness();
    await expect(handleToolsCommand(["unknown"], harness.deps)).rejects.toThrow(
      "Unknown tools subcommand: unknown"
    );
  });

  it("legacy handler executes get-user, get-cast, and cast-preview", async () => {
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
            text: async () => JSON.stringify({ result: { cast: { text: "hi" } } }),
          };
        }
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({ tools: [{ name: "getUser" }, { name: "getCast" }, { name: "castPreview" }] }),
        };
      },
    });

    await handleToolsCommand(["get-user", "alice"], harness.deps);
    expect(parseLastJsonOutput(harness.outputs)).toEqual({
      ok: true,
      result: { cast: { text: "hi" } },
    });

    await handleToolsCommand(["get-cast", "0xabc"], harness.deps);
    expect(parseLastJsonOutput(harness.outputs)).toEqual({
      ok: true,
      cast: { text: "hi" },
    });

    await handleToolsCommand(["cast-preview", "--text", "hello"], harness.deps);
    expect(parseLastJsonOutput(harness.outputs)).toEqual({
      ok: true,
      cast: { text: "hi" },
    });
  });

  it("legacy handler enforces treasury usage and emits normalized result", async () => {
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
            text: async () => JSON.stringify({ data: { snapshots: 2 } }),
          };
        }
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ tools: [{ name: "get-treasury-stats" }] }),
        };
      },
    });

    await expect(handleToolsCommand(["get-treasury-stats", "extra"], harness.deps)).rejects.toThrow(
      "Usage:"
    );

    await handleToolsCommand(["get-treasury-stats"], harness.deps);
    expect(parseLastJsonOutput(harness.outputs)).toEqual({
      ok: true,
      data: { snapshots: 2 },
    });
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

    const output = await executeToolsTreasuryStatsCommand(harness.deps);
    expect(output).toEqual({
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

    const withOkOutput = await executeToolsGetUserCommand({ fname: "alice" }, withOkHarness.deps);
    expect(withOkOutput).toEqual({
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

    const withoutOkOutput = await executeToolsGetUserCommand(
      { fname: "bob" },
      withoutOkHarness.deps
    );
    expect(withoutOkOutput).toEqual({
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

    const getCastOutput = await executeToolsGetCastCommand(
      { identifier: "0xabc" },
      getCastHarness.deps
    );
    expect(getCastOutput).toEqual({
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

    const castPreviewOutput = await executeToolsCastPreviewCommand(
      { text: "hi" },
      castPreviewHarness.deps
    );
    expect(castPreviewOutput).toEqual({
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

    const output = await executeToolsTreasuryStatsCommand(harness.deps);
    expect(output).toEqual({
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

    const output = await executeToolsTreasuryStatsCommand(harness.deps);
    expect(output).toEqual({
      ok: true,
      data: { foo: "bar" },
    });
  });
});
