import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";
import { createCobuildIncurCli } from "../src/cli-incur.js";
import { DEFAULT_CHAT_API_URL } from "../src/config.js";
import { createHarness } from "./helpers.js";

function createJsonResponder(body: unknown, status = 200) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  });
}

function parseLastJsonOutput(outputs: string[]): unknown {
  return JSON.parse(outputs.at(-1) ?? "null");
}

describe("backbone cutover audit regressions", () => {
  it("keeps interactive setup wizard text on stderr while stdout remains structured JSON", async () => {
    const harness = createHarness({
      fetchResponder: createJsonResponder({ ok: true, address: "0xabc" }),
    });
    harness.deps.isInteractive = () => true;

    await runCli(
      ["setup", "--url", "https://api.example", "--token", "bbt_secret", "--payer-mode", "skip"],
      harness.deps
    );

    expect(harness.errors).toContain("CLI Setup Wizard");
    expect(harness.errors).toContain("[1/4] Interface URL");
    expect(harness.outputs).toHaveLength(1);
    expect(harness.outputs.join("\n")).not.toContain("CLI Setup Wizard");
    expect(parseLastJsonOutput(harness.outputs)).toEqual({
      ok: true,
      config: {
        interfaceUrl: "https://api.example",
        chatApiUrl: DEFAULT_CHAT_API_URL,
        agent: "default",
        path: harness.configFile,
      },
      defaultNetwork: "base-sepolia",
      wallet: { ok: true, address: "0xabc" },
      next: [
        "Run: cli wallet",
        "Run: cli send usdc 0.10 <to> (or cli send eth 0.00001 <to>)",
      ],
    });
  });

  it("round-trips docs queries that begin with the positional escape marker", async () => {
    const escapedPrefixQuery = "__incur_positional_b64__aGVsbG8";
    let postedExecutionInput: Record<string, unknown> | undefined;
    const harness = createHarness({
      config: {
        url: "https://interface.example",
        token: "bbt_secret",
      },
      fetchResponder: async (input, init) => {
        const url = String(input);
        if (url.endsWith("/v1/tools")) {
          return await createJsonResponder({ tools: [{ name: "docsSearch" }] })();
        }
        if (url.endsWith("/v1/tool-executions")) {
          postedExecutionInput = JSON.parse(String(init?.body)).input as Record<string, unknown>;
          return await createJsonResponder({ data: [{ filename: "setup.mdx" }] })();
        }
        return await createJsonResponder({ ok: false }, 500)();
      },
    });

    await runCli(["docs", escapedPrefixQuery], harness.deps);

    expect(postedExecutionInput).toEqual({ query: escapedPrefixQuery });
    expect(parseLastJsonOutput(harness.outputs)).toEqual({
      query: escapedPrefixQuery,
      count: 1,
      results: [{ filename: "setup.mdx" }],
    });
  });

  it("does not decode malformed escaped positional markers when passed directly to Incur", async () => {
    const malformedEscapedQuery = "__incur_positional_b64__invalid!value";
    let postedExecutionInput: Record<string, unknown> | undefined;
    const harness = createHarness({
      config: {
        url: "https://interface.example",
        token: "bbt_secret",
      },
      fetchResponder: async (input, init) => {
        const url = String(input);
        if (url.endsWith("/v1/tools")) {
          return await createJsonResponder({ tools: [{ name: "docsSearch" }] })();
        }
        if (url.endsWith("/v1/tool-executions")) {
          postedExecutionInput = JSON.parse(String(init?.body)).input as Record<string, unknown>;
          return await createJsonResponder({ data: [] })();
        }
        return await createJsonResponder({ ok: false }, 500)();
      },
    });
    const cli = createCobuildIncurCli(harness.deps);
    await cli.serve(["docs", malformedEscapedQuery], {
      env: harness.deps.env,
      stdout: (chunk) => {
        harness.outputs.push(chunk.trim());
      },
    });

    expect(postedExecutionInput).toEqual({ query: malformedEscapedQuery });
  });
});
