import { describe, expect, it } from "vitest";
import {
  executeToolsCastPreviewCommand,
  executeToolsGetCastCommand,
  executeToolsGetUserCommand,
  executeToolsTreasuryStatsCommand,
} from "../src/commands/tools.js";
import { createHarness } from "./helpers.js";

function getToolExecutionPayloads(fetchCalls: Array<unknown[]>): Array<Record<string, unknown>> {
  return fetchCalls.flatMap((call) => {
    const input = call[0];
    if (!String(input).endsWith("/v1/tool-executions")) {
      return [];
    }
    const init = (call[1] ?? {}) as { body?: unknown };
    return [JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>];
  });
}

describe("tools branch coverage", () => {
  it("execute surfaces enforce usage requirements", async () => {
    const harness = createHarness();
    await expect(executeToolsGetUserCommand({}, harness.deps)).rejects.toThrow("Usage:");
    await expect(executeToolsGetUserCommand({ fname: "   " }, harness.deps)).rejects.toThrow("Usage:");
    await expect(executeToolsGetCastCommand({}, harness.deps)).rejects.toThrow("Usage:");
    await expect(executeToolsCastPreviewCommand({}, harness.deps)).rejects.toThrow("Usage:");
    await expect(
      executeToolsCastPreviewCommand({ text: "hello", embed: ["a", "b", "c"] }, harness.deps)
    ).rejects.toThrow("A maximum of two --embed values are allowed.");
    await expect(
      executeToolsGetCastCommand({ identifier: "0xabc", type: "other" }, harness.deps)
    ).rejects.toThrow("--type must be either 'hash' or 'url'");
  });

  it("execute get-user, get-cast, and cast-preview normalize responses", async () => {
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

    const getUserOutput = await executeToolsGetUserCommand({ fname: "alice" }, harness.deps);
    expect(getUserOutput).toEqual({
      ok: true,
      result: { cast: { text: "hi" } },
    });

    const getCastOutput = await executeToolsGetCastCommand({ identifier: "0xabc" }, harness.deps);
    expect(getCastOutput).toEqual({
      ok: true,
      cast: { text: "hi" },
    });

    const castPreviewOutput = await executeToolsCastPreviewCommand({ text: "hello" }, harness.deps);
    expect(castPreviewOutput).toEqual({
      ok: true,
      cast: { text: "hi" },
    });
  });

  it("execute get-cast infers URL type and trims identifiers before canonical execution", async () => {
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
            text: async () => JSON.stringify({ cast: { ok: true } }),
          };
        }
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ tools: [{ name: "getCast" }] }),
        };
      },
    });

    await executeToolsGetCastCommand(
      { identifier: "  https://warpcast.com/alice/0xabc  " },
      harness.deps
    );

    expect(getToolExecutionPayloads(harness.fetchMock.mock.calls)).toEqual([
      {
        name: "getCast",
        input: {
          identifier: "https://warpcast.com/alice/0xabc",
          type: "url",
        },
      },
    ]);
  });

  it("execute cast-preview trims text and embed URLs before canonical execution", async () => {
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
            text: async () => JSON.stringify({ cast: { text: "hi" } }),
          };
        }
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ tools: [{ name: "castPreview" }] }),
        };
      },
    });

    await executeToolsCastPreviewCommand(
      {
        text: "  hello  ",
        embed: ["  https://1.example  ", "", "   ", "https://2.example"],
      },
      harness.deps
    );

    expect(getToolExecutionPayloads(harness.fetchMock.mock.calls)).toEqual([
      {
        name: "castPreview",
        input: {
          text: "hello",
          embeds: [{ url: "https://1.example" }, { url: "https://2.example" }],
        },
      },
    ]);
  });

  it("treasury stats emits normalized result", async () => {
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

    const output = await executeToolsTreasuryStatsCommand(harness.deps);
    expect(output).toEqual({
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
