import { describe, expect, it } from "vitest";
import { createCliDeps, runCli, runCliFromProcess } from "../src/cli.js";
import { createHarness } from "./helpers.js";

const GENERATED_UUID = "8e03978e-40d5-43e8-bc93-6894a57f9324";
const EXPLICIT_UUID = "75d6e51f-4f27-4f17-b32f-4708fdb0f3be";
const VALID_TO = "0x000000000000000000000000000000000000dEaD";

function parseLastJsonOutput(outputs: string[]): unknown {
  return JSON.parse(outputs.at(-1) ?? "null");
}

function expectedPatTokenRef(interfaceUrl: string | null) {
  if (!interfaceUrl) {
    return {
      source: "file",
      provider: "default",
      id: "/pat:default",
    };
  }
  const origin = new URL(interfaceUrl).origin;
  const encoded = origin.replaceAll("~", "~0").replaceAll("/", "~1");
  return {
    source: "file",
    provider: "default",
    id: `/pat:${encoded}`,
  };
}

function expectedDefaultSecretsConfig() {
  return {
    providers: {
      default: {
        source: "file",
        path: "/tmp/cli-tests/.cobuild-cli/secrets.json",
        mode: "json",
      },
    },
    defaults: {
      env: "default",
      file: "default",
      exec: "default",
    },
  };
}

function expectedPersistedSetupConfig(url: string) {
  return {
    url,
    agent: "default",
    auth: {
      tokenRef: expectedPatTokenRef(url),
    },
    secrets: expectedDefaultSecretsConfig(),
  };
}

function createJsonResponder(body: unknown, status = 200) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  });
}

function findFetchCallByUrl(
  calls: any[][],
  expectedUrl: string
): [string | URL, any] {
  const match = calls.find(([input]) => String(input) === expectedUrl);
  if (!match) {
    throw new Error(`Expected fetch call for ${expectedUrl}`);
  }
  return match as [string | URL, any];
}

describe("cli", () => {
  it("prints usage when command is missing", async () => {
    const harness = createHarness();
    await runCli([], harness.deps);
    expect(harness.outputs[0]).toContain("Usage:");
  });

  it("prints usage when argv starts with -- sentinel and no command", async () => {
    const harness = createHarness();
    await runCli(["--"], harness.deps);
    expect(harness.outputs[0]).toContain("cli");
  });

  it("throws for unknown command", async () => {
    const harness = createHarness();
    await expect(runCli(["unknown"], harness.deps)).rejects.toThrow("Unknown command: unknown");
  });

  it("supports createCliDeps overrides", () => {
    const harness = createHarness();
    const deps = createCliDeps({ stdout: harness.deps.stdout, stderr: harness.deps.stderr });
    expect(deps.stdout).toBe(harness.deps.stdout);
    expect(deps.stderr).toBe(harness.deps.stderr);
  });

  it("config set persists values and config show masks token", async () => {
    const harness = createHarness();

    await runCli(
      [
        "config",
        "set",
        "--url",
        "https://api.example",
        "--token",
        "abcdefghijk",
        "--agent",
        "ops",
      ],
      harness.deps
    );

    await runCli(["config", "show"], harness.deps);

    expect(harness.outputs[0]).toContain("Saved config");
    expect(parseLastJsonOutput(harness.outputs)).toEqual({
      interfaceUrl: "https://api.example",
      token: "abcdefgh...",
      tokenRef: expectedPatTokenRef("https://api.example"),
      agent: "ops",
      path: harness.configFile,
    });
  });

  it("config set rejects removed --chat-api-url flag", async () => {
    const harness = createHarness();

    await expect(
      runCli(["config", "set", "--chat-api-url", "https://chat.example"], harness.deps)
    ).rejects.toThrow(/chat-api-url/);
  });

  it("config without subcommand prints usage", async () => {
    const harness = createHarness();
    await runCli(["config"], harness.deps);
    expect(harness.outputs[0]).toContain("Usage:");
  });

  it("config set requires at least one value", async () => {
    const harness = createHarness();
    await expect(runCli(["config", "set"], harness.deps)).rejects.toThrow(
      "Usage: cli config set --url <interface-url> --token <pat>|--token-file <path>|--token-stdin [--agent <key>]"
    );
  });

  it("config subcommand errors when unknown", async () => {
    const harness = createHarness();
    await expect(runCli(["config", "delete"], harness.deps)).rejects.toThrow(
      "Unknown config subcommand: delete"
    );
  });

  it("config show emits nulls when values are absent", async () => {
    const harness = createHarness();
    await runCli(["config", "show"], harness.deps);
    expect(parseLastJsonOutput(harness.outputs)).toEqual({
      interfaceUrl: null,
      token: null,
      tokenRef: null,
      agent: null,
      path: harness.configFile,
    });
  });

  it("config set supports partial updates", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "first-token",
        agent: "agent-a",
      },
    });

    await runCli(["config", "set", "--token", "next-token"], harness.deps);
    await runCli(["config", "show"], harness.deps);

    expect(parseLastJsonOutput(harness.outputs)).toEqual({
      interfaceUrl: "https://api.example",
      token: "next-tok...",
      tokenRef: expectedPatTokenRef("https://api.example"),
      agent: "agent-a",
      path: harness.configFile,
    });
  });

  it("setup saves config and initializes wallet", async () => {
    const harness = createHarness({
      fetchResponder: createJsonResponder({ ok: true, address: "0xabc" }),
    });

    await runCli(
      [
        "setup",
        "--url",
        "https://api.example",
        "--token",
        "bbt_secret",
        "--network",
        "base-sepolia",
      ],
      harness.deps
    );

    const [input, init] = harness.fetchMock.mock.calls[0];
    expect(String(input)).toBe("https://api.example/api/buildbot/wallet");
    expect(JSON.parse(String(init?.body))).toEqual({
      agentKey: "default",
      defaultNetwork: "base-sepolia",
    });

    expect(parseLastJsonOutput(harness.outputs)).toEqual({
      ok: true,
      config: {
        interfaceUrl: "https://api.example",
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

  it("setup supports machine-readable mode with --json", async () => {
    const harness = createHarness({
      fetchResponder: createJsonResponder({ ok: true, address: "0xabc" }),
    });

    await runCli(
      [
        "setup",
        "--url",
        "https://api.example",
        "--token",
        "bbt_secret",
        "--network",
        "base-sepolia",
        "--json",
      ],
      harness.deps
    );

    expect(harness.outputs).not.toContain(`Saved config: ${harness.configFile}`);
    expect(parseLastJsonOutput(harness.outputs)).toEqual({
      ok: true,
      config: {
        interfaceUrl: "https://api.example",
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

  it("setup rejects removed --chat-api-url flag", async () => {
    const harness = createHarness({
      fetchResponder: createJsonResponder({ ok: true, address: "0xabc" }),
    });

    await expect(
      runCli(["setup", "--url", "https://interface.example", "--chat-api-url", "https://chat.example"], harness.deps)
    ).rejects.toThrow(/chat-api-url/);
    expect(harness.fetchMock).not.toHaveBeenCalled();
  });

  it("setup clears saved token and gives guidance when wallet bootstrap is unauthorized", async () => {
    const harness = createHarness({
      fetchResponder: createJsonResponder({ ok: false, error: "Unauthorized" }, 401),
    });

    await expect(
      runCli(
        [
          "setup",
          "--url",
          "https://api.example",
          "--token",
          "bbt_bad_token",
          "--network",
          "base-sepolia",
        ],
        harness.deps
      )
    ).rejects.toThrow(
      "PAT authorization failed while bootstrapping wallet access. The saved token was cleared to avoid reusing it. Run setup again and approve a fresh token in the browser."
    );

    expect(JSON.parse(harness.files.get(harness.configFile) ?? "{}")).toEqual({
      url: "https://api.example",
      agent: "default",
      secrets: expectedDefaultSecretsConfig(),
    });
  });

  it("setup gives actionable guidance when wallet bootstrap returns a generic internal error", async () => {
    const harness = createHarness({
      fetchResponder: createJsonResponder({ ok: false, error: "Internal error" }, 500),
    });

    await expect(
      runCli(
        [
          "setup",
          "--url",
          "https://api.example",
          "--token",
          "bbt_secret",
          "--network",
          "base-sepolia",
        ],
        harness.deps
      )
    ).rejects.toThrow(
      "Wallet bootstrap failed on the interface server. Check interface logs, run the CLI SQL migrations, and verify CDP env vars are set (CDP_API_KEY_ID, CDP_API_KEY_SECRET, CDP_WALLET_SECRET)."
    );

    expect(JSON.parse(harness.files.get(harness.configFile) ?? "{}")).toEqual(
      expectedPersistedSetupConfig("https://api.example")
    );
  });

  it("setup defaults interface url to co.build in non-interactive mode", async () => {
    const harness = createHarness({
      fetchResponder: createJsonResponder({ ok: true, address: "0xabc" }),
    });

    await runCli(["setup", "--token", "bbt_secret"], harness.deps);

    const [input] = harness.fetchMock.mock.calls[0];
    expect(String(input)).toBe("https://co.build/api/buildbot/wallet");
    expect(JSON.parse(harness.files.get(harness.configFile) ?? "{}")).toEqual(
      expectedPersistedSetupConfig("https://co.build")
    );
  });

  it("setup supports --dev default url for localhost", async () => {
    const harness = createHarness({
      fetchResponder: createJsonResponder({ ok: true, address: "0xabc" }),
    });

    await runCli(["setup", "--dev", "--token", "bbt_secret"], harness.deps);

    const [input] = harness.fetchMock.mock.calls[0];
    expect(String(input)).toBe("http://localhost:3000/api/buildbot/wallet");
    expect(JSON.parse(harness.files.get(harness.configFile) ?? "{}")).toEqual(
      expectedPersistedSetupConfig("http://localhost:3000")
    );
  });

  it("setup normalizes bare --url host input", async () => {
    const harness = createHarness({
      fetchResponder: createJsonResponder({ ok: true, address: "0xabc" }),
    });

    await runCli(["setup", "--url", "localhost:3000", "--token", "bbt_secret"], harness.deps);

    const [input] = harness.fetchMock.mock.calls[0];
    expect(String(input)).toBe("http://localhost:3000/api/buildbot/wallet");
    expect(JSON.parse(harness.files.get(harness.configFile) ?? "{}")).toEqual(
      expectedPersistedSetupConfig("http://localhost:3000")
    );
  });

  it("setup normalizes bare localhost host input with a path", async () => {
    const harness = createHarness({
      fetchResponder: createJsonResponder({ ok: true, address: "0xabc" }),
    });

    await runCli(
      ["setup", "--url", "localhost:3000/co.build", "--token", "bbt_secret"],
      harness.deps
    );

    const [input] = harness.fetchMock.mock.calls[0];
    expect(String(input)).toBe("http://localhost:3000/co.build/api/buildbot/wallet");
    expect(JSON.parse(harness.files.get(harness.configFile) ?? "{}")).toEqual(
      expectedPersistedSetupConfig("http://localhost:3000/co.build")
    );
  });

  it("setup normalizes bare public host input to https", async () => {
    const harness = createHarness({
      fetchResponder: createJsonResponder({ ok: true, address: "0xabc" }),
    });

    await runCli(["setup", "--url", "co.build", "--token", "bbt_secret"], harness.deps);

    const [input] = harness.fetchMock.mock.calls[0];
    expect(String(input)).toBe("https://co.build/api/buildbot/wallet");
    expect(JSON.parse(harness.files.get(harness.configFile) ?? "{}")).toEqual(
      expectedPersistedSetupConfig("https://co.build")
    );
  });

  it("setup requires token in non-interactive mode when none is configured", async () => {
    const harness = createHarness();
    await expect(runCli(["setup", "--url", "https://api.example"], harness.deps)).rejects.toThrow(
      "Missing --token and no config found."
    );
  });

  it("setup uses configured values and COBUILD_CLI_NETWORK fallback", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
        agent: "stored-agent",
      },
      fetchResponder: createJsonResponder({ ok: true, address: "0xdef" }),
    });

    const previous = process.env.COBUILD_CLI_NETWORK;
    process.env.COBUILD_CLI_NETWORK = "base";

    try {
      await runCli(["setup"], harness.deps);
    } finally {
      if (previous === undefined) {
        delete process.env.COBUILD_CLI_NETWORK;
      } else {
        process.env.COBUILD_CLI_NETWORK = previous;
      }
    }

    const [, init] = harness.fetchMock.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual({
      agentKey: "stored-agent",
      defaultNetwork: "base",
    });
  });

  it("wallet uses config agent by default", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
        agent: "stored-agent",
      },
      fetchResponder: createJsonResponder({ ok: true, address: "0xabc" }),
    });

    await runCli(["wallet", "--network", "base-sepolia"], harness.deps);

    const [input, init] = harness.fetchMock.mock.calls[0];
    expect(String(input)).toBe("https://api.example/api/buildbot/wallet");
    expect(JSON.parse(String(init?.body))).toEqual({
      defaultNetwork: "base-sepolia",
      agentKey: "stored-agent",
    });
    expect(parseLastJsonOutput(harness.outputs)).toEqual({
      ok: true,
      address: "0xabc",
    });
  });

  it("wallet allows agent override", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
      fetchResponder: createJsonResponder({ ok: true, address: "0xabc" }),
    });

    await runCli(["wallet", "--agent", "override"], harness.deps);

    const [, init] = harness.fetchMock.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual({
      agentKey: "override",
    });
  });

  it("docs requires a query", async () => {
    const harness = createHarness();
    await expect(runCli(["docs"], harness.deps)).rejects.toThrow(
      "Usage: cli docs <query> [--limit <n>]"
    );
  });

  it("docs validates --limit bounds", async () => {
    const harness = createHarness();
    await expect(runCli(["docs", "setup", "--limit", "0"], harness.deps)).rejects.toThrow(
      "--limit must be between 1 and 20"
    );
    await expect(runCli(["docs", "setup", "--limit", "21"], harness.deps)).rejects.toThrow(
      "--limit must be between 1 and 20"
    );
  });

  it("docs validates --limit integer format", async () => {
    const harness = createHarness();
    await expect(runCli(["docs", "setup", "--limit", "1.5"], harness.deps)).rejects.toThrow(
      "--limit must be an integer"
    );
  });

  it("docs posts query payload and returns JSON result", async () => {
    const harness = createHarness({
      config: {
        url: "https://interface.example",
        token: "bbt_secret",
      },
      fetchResponder: createJsonResponder({
        query: "setup approval",
        count: 1,
        results: [{ filename: "self-hosted/chat-api.mdx" }],
      }),
    });

    await runCli(["docs", "setup", "approval", "--limit", "5"], harness.deps);

    const [discoveryInput, discoveryInit] = harness.fetchMock.mock.calls[0];
    expect(String(discoveryInput)).toBe("https://interface.example/v1/tools");
    expect(discoveryInit).toMatchObject({ method: "GET" });

    const [, init] = findFetchCallByUrl(
      harness.fetchMock.mock.calls,
      "https://interface.example/v1/tool-executions"
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      name: "docsSearch",
      input: {
        query: "setup approval",
        limit: 5,
      },
    });
    expect(parseLastJsonOutput(harness.outputs)).toEqual({
      query: "setup approval",
      count: 1,
      results: [{ filename: "self-hosted/chat-api.mdx" }],
    });
  });

  it("docs omits limit from payload when --limit is not provided", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
      fetchResponder: createJsonResponder({
        query: "setup approval",
        count: 1,
        results: [{ filename: "self-hosted/chat-api.mdx" }],
      }),
    });

    await runCli(["docs", "setup", "approval"], harness.deps);

    const [, init] = findFetchCallByUrl(
      harness.fetchMock.mock.calls,
      "https://api.example/v1/tool-executions"
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      name: "docsSearch",
      input: { query: "setup approval" },
    });
  });

  it("docs accepts dashed query terms when preceded by -- sentinel", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
      fetchResponder: createJsonResponder({
        query: "--token-stdin",
        count: 0,
        results: [],
      }),
    });

    await runCli(["docs", "--", "--token-stdin"], harness.deps);

    const [, init] = findFetchCallByUrl(
      harness.fetchMock.mock.calls,
      "https://api.example/v1/tool-executions"
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      name: "docsSearch",
      input: { query: "--token-stdin" },
    });
  });

  it("docs normalizes canonical array output to stable docs envelope", async () => {
    const harness = createHarness({
      config: {
        url: "https://interface.example",
        token: "bbt_secret",
      },
      fetchResponder: async (input) => {
        const url = String(input);
        if (url.endsWith("/v1/tools")) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ tools: [{ name: "docsSearch" }] }),
          };
        }
        if (url.endsWith("/v1/tool-executions")) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ output: [{ filename: "one.mdx" }] }),
          };
        }
        return {
          ok: false,
          status: 500,
          text: async () => JSON.stringify({ ok: false, error: "Unexpected URL" }),
        };
      },
    });

    await runCli(["docs", "setup"], harness.deps);
    expect(parseLastJsonOutput(harness.outputs)).toEqual({
      query: "setup",
      count: 1,
      results: [{ filename: "one.mdx" }],
    });
  });

  it("docs normalizes canonical payloads that expose results without count", async () => {
    const harness = createHarness({
      config: {
        url: "https://interface.example",
        token: "bbt_secret",
      },
      fetchResponder: async (input) => {
        const url = String(input);
        if (url.endsWith("/v1/tools")) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ tools: [{ name: "docsSearch" }] }),
          };
        }
        if (url.endsWith("/v1/tool-executions")) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ query: "setup", results: [{ filename: "one.mdx" }] }),
          };
        }
        return {
          ok: false,
          status: 500,
          text: async () => JSON.stringify({ ok: false, error: "Unexpected URL" }),
        };
      },
    });

    await runCli(["docs", "setup"], harness.deps);
    expect(parseLastJsonOutput(harness.outputs)).toEqual({
      query: "setup",
      count: 1,
      results: [{ filename: "one.mdx" }],
    });
  });

  it("docs normalizes scalar canonical payloads to a single-result envelope", async () => {
    const harness = createHarness({
      config: {
        url: "https://interface.example",
        token: "bbt_secret",
      },
      fetchResponder: async (input) => {
        const url = String(input);
        if (url.endsWith("/v1/tools")) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ tools: [{ name: "docsSearch" }] }),
          };
        }
        if (url.endsWith("/v1/tool-executions")) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ result: "snippet" }),
          };
        }
        return {
          ok: false,
          status: 500,
          text: async () => JSON.stringify({ ok: false, error: "Unexpected URL" }),
        };
      },
    });

    await runCli(["docs", "setup"], harness.deps);
    expect(parseLastJsonOutput(harness.outputs)).toEqual({
      query: "setup",
      count: 1,
      results: ["snippet"],
    });
  });

  it("docs normalizes canonical data arrays and null payloads", async () => {
    const harness = createHarness({
      config: {
        url: "https://interface.example",
        token: "bbt_secret",
      },
      fetchResponder: async (input) => {
        const url = String(input);
        if (url.endsWith("/v1/tools")) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ tools: [{ name: "docsSearch" }] }),
          };
        }
        if (url.endsWith("/v1/tool-executions")) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ data: [{ filename: "one.mdx" }] }),
          };
        }
        return {
          ok: false,
          status: 500,
          text: async () => JSON.stringify({ ok: false, error: "Unexpected URL" }),
        };
      },
    });

    await runCli(["docs", "setup"], harness.deps);
    expect(parseLastJsonOutput(harness.outputs)).toEqual({
      query: "setup",
      count: 1,
      results: [{ filename: "one.mdx" }],
    });

    harness.fetchMock.mockClear();
    harness.deps.fetch = async (input) => {
      const url = String(input);
      if (url.endsWith("/v1/tools")) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ tools: [{ name: "docsSearch" }] }),
        };
      }
      if (url.endsWith("/v1/tool-executions")) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ result: null }),
        };
      }
      return {
        ok: false,
        status: 500,
        text: async () => JSON.stringify({ ok: false, error: "Unexpected URL" }),
      };
    };

    await runCli(["docs", "setup"], harness.deps);
    expect(parseLastJsonOutput(harness.outputs)).toEqual({
      query: "setup",
      count: 0,
      results: [],
    });
  });

  it("tools requires a known subcommand", async () => {
    const harness = createHarness();

    await runCli(["tools"], harness.deps);
    expect(harness.outputs[0]).toContain("Usage:");
    await expect(runCli(["tools", "unknown"], harness.deps)).rejects.toThrow(
      "Unknown tools subcommand: unknown"
    );
  });

  it("tools get-user posts fname payload", async () => {
    const harness = createHarness({
      config: {
        url: "https://interface.example",
        token: "bbt_secret",
      },
      fetchResponder: createJsonResponder({ ok: true, result: { fid: 1, fname: "alice" } }),
    });

    await runCli(["tools", "get-user", "alice"], harness.deps);

    const [input, init] = findFetchCallByUrl(
      harness.fetchMock.mock.calls,
      "https://interface.example/v1/tool-executions"
    );
    expect(String(input)).toBe("https://interface.example/v1/tool-executions");
    expect(JSON.parse(String(init?.body))).toEqual({
      name: "getUser",
      input: { fname: "alice" },
    });
    expect(parseLastJsonOutput(harness.outputs)).toEqual({
      ok: true,
      result: { fid: 1, fname: "alice" },
    });
  });

  it("tools get-user requires a fname", async () => {
    const harness = createHarness();
    await expect(runCli(["tools", "get-user"], harness.deps)).rejects.toThrow("Usage:");
  });

  it("tools get-cast infers URL type and allows explicit type", async () => {
    const harness = createHarness({
      config: {
        url: "https://interface.example",
        token: "bbt_secret",
      },
      fetchResponder: createJsonResponder({ ok: true, cast: { hash: "0xabc" } }),
    });

    await runCli(
      ["tools", "get-cast", "https://warpcast.com/alice/0xabc"],
      harness.deps
    );
    let [input, init] = findFetchCallByUrl(
      harness.fetchMock.mock.calls,
      "https://interface.example/v1/tool-executions"
    );
    expect(String(input)).toBe("https://interface.example/v1/tool-executions");
    expect(JSON.parse(String(init?.body))).toEqual({
      name: "getCast",
      input: {
        identifier: "https://warpcast.com/alice/0xabc",
        type: "url",
      },
    });

    harness.fetchMock.mockClear();
    await runCli(["tools", "get-cast", "0xabc", "--type", "hash"], harness.deps);
    [input, init] = findFetchCallByUrl(
      harness.fetchMock.mock.calls,
      "https://interface.example/v1/tool-executions"
    );
    expect(String(input)).toBe("https://interface.example/v1/tool-executions");
    expect(JSON.parse(String(init?.body))).toEqual({
      name: "getCast",
      input: {
        identifier: "0xabc",
        type: "hash",
      },
    });
  });

  it("tools get-cast preserves escaped identifiers that start with dashes", async () => {
    const harness = createHarness({
      config: {
        url: "https://interface.example",
        token: "bbt_secret",
      },
      fetchResponder: createJsonResponder({ ok: true, cast: { hash: "0xabc" } }),
    });

    await runCli(["tools", "get-cast", "--", "--type"], harness.deps);
    let [, init] = findFetchCallByUrl(
      harness.fetchMock.mock.calls,
      "https://interface.example/v1/tool-executions"
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      name: "getCast",
      input: {
        identifier: "--type",
        type: "hash",
      },
    });

    harness.fetchMock.mockClear();
    await runCli(["tools", "get-cast", "--type", "url", "--", "--hash-like"], harness.deps);
    [, init] = findFetchCallByUrl(
      harness.fetchMock.mock.calls,
      "https://interface.example/v1/tool-executions"
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      name: "getCast",
      input: {
        identifier: "--hash-like",
        type: "url",
      },
    });
  });

  it("tools get-cast validates type", async () => {
    const harness = createHarness();
    await expect(runCli(["tools", "get-cast", "0xabc", "--type", "other"], harness.deps)).rejects.toThrow(
      "--type must be either 'hash' or 'url'"
    );
  });

  it("tools cast-preview validates required text and embed count", async () => {
    const harness = createHarness();
    await expect(runCli(["tools", "cast-preview"], harness.deps)).rejects.toThrow("Usage:");
    await expect(
      runCli(
        [
          "tools",
          "cast-preview",
          "--text",
          "hello",
          "--embed",
          "https://1.example",
          "--embed",
          "https://2.example",
          "--embed",
          "https://3.example",
        ],
        harness.deps
      )
    ).rejects.toThrow("A maximum of two --embed values are allowed.");
  });

  it("tools cast-preview posts normalized payload", async () => {
    const harness = createHarness({
      config: {
        url: "https://interface.example",
        token: "bbt_secret",
      },
      fetchResponder: createJsonResponder({ ok: true }),
    });

    await runCli(
      [
        "tools",
        "cast-preview",
        "--text",
        "hello",
        "--embed",
        "https://1.example",
        "--embed",
        "https://2.example",
        "--parent",
        "0xparent",
      ],
      harness.deps
    );

    const [input, init] = findFetchCallByUrl(
      harness.fetchMock.mock.calls,
      "https://interface.example/v1/tool-executions"
    );
    expect(String(input)).toBe("https://interface.example/v1/tool-executions");
    expect(JSON.parse(String(init?.body))).toEqual({
      name: "castPreview",
      input: {
        text: "hello",
        embeds: [{ url: "https://1.example" }, { url: "https://2.example" }],
        parent: "0xparent",
      },
    });
  });

  it("tools get-treasury-stats posts empty payload and rejects unexpected args", async () => {
    const harness = createHarness({
      config: {
        url: "https://interface.example",
        token: "bbt_secret",
      },
      fetchResponder: createJsonResponder({ ok: true, data: { asOf: "2026-02-25T00:00:00.000Z" } }),
    });

    await expect(runCli(["tools", "get-treasury-stats", "extra"], harness.deps)).rejects.toThrow(
      "Usage:"
    );

    await runCli(["tools", "get-treasury-stats"], harness.deps);
    const [input, init] = findFetchCallByUrl(
      harness.fetchMock.mock.calls,
      "https://interface.example/v1/tool-executions"
    );
    expect(String(input)).toBe("https://interface.example/v1/tool-executions");
    expect(JSON.parse(String(init?.body))).toEqual({
      name: "get-treasury-stats",
      input: {},
    });
  });

  it("tools get-user normalizes canonical responses that omit ok", async () => {
    const harness = createHarness({
      config: {
        url: "https://interface.example",
        token: "bbt_secret",
      },
      fetchResponder: async (input, init) => {
        const url = String(input);
        if (url.endsWith("/v1/tools")) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ tools: [{ name: "getUser" }] }),
          };
        }
        if (url.endsWith("/v1/tool-executions")) {
          expect(JSON.parse(String(init?.body))).toEqual({
            name: "getUser",
            input: { fname: "alice" },
          });
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ result: { fid: 1, fname: "alice" } }),
          };
        }
        return {
          ok: false,
          status: 500,
          text: async () => JSON.stringify({ ok: false, error: "Unexpected URL" }),
        };
      },
    });

    await runCli(["tools", "get-user", "alice"], harness.deps);
    expect(parseLastJsonOutput(harness.outputs)).toEqual({
      ok: true,
      result: { fid: 1, fname: "alice" },
    });
  });

  it("tools get-cast normalizes canonical responses that omit ok", async () => {
    const harness = createHarness({
      config: {
        url: "https://interface.example",
        token: "bbt_secret",
      },
      fetchResponder: async (input, init) => {
        const url = String(input);
        if (url.endsWith("/v1/tools")) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ tools: [{ name: "getCast" }] }),
          };
        }
        if (url.endsWith("/v1/tool-executions")) {
          expect(JSON.parse(String(init?.body))).toEqual({
            name: "getCast",
            input: { identifier: "0xabc", type: "hash" },
          });
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ cast: { hash: "0xabc" } }),
          };
        }
        return {
          ok: false,
          status: 500,
          text: async () => JSON.stringify({ ok: false, error: "Unexpected URL" }),
        };
      },
    });

    await runCli(["tools", "get-cast", "0xabc", "--type", "hash"], harness.deps);
    expect(parseLastJsonOutput(harness.outputs)).toEqual({
      ok: true,
      cast: { hash: "0xabc" },
    });
  });

  it("tools cast-preview normalizes canonical responses that omit ok", async () => {
    const harness = createHarness({
      config: {
        url: "https://interface.example",
        token: "bbt_secret",
      },
      fetchResponder: async (input, init) => {
        const url = String(input);
        if (url.endsWith("/v1/tools")) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ tools: [{ name: "castPreview" }] }),
          };
        }
        if (url.endsWith("/v1/tool-executions")) {
          expect(JSON.parse(String(init?.body))).toEqual({
            name: "castPreview",
            input: { text: "hello" },
          });
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ cast: { text: "hello" } }),
          };
        }
        return {
          ok: false,
          status: 500,
          text: async () => JSON.stringify({ ok: false, error: "Unexpected URL" }),
        };
      },
    });

    await runCli(["tools", "cast-preview", "--text", "hello"], harness.deps);
    expect(parseLastJsonOutput(harness.outputs)).toEqual({
      ok: true,
      cast: { text: "hello" },
    });
  });

  it("tools get-treasury-stats normalizes canonical responses that omit ok", async () => {
    const harness = createHarness({
      config: {
        url: "https://interface.example",
        token: "bbt_secret",
      },
      fetchResponder: async (input, init) => {
        const url = String(input);
        if (url.endsWith("/v1/tools")) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ tools: [{ name: "get-treasury-stats" }] }),
          };
        }
        if (url.endsWith("/v1/tool-executions")) {
          expect(JSON.parse(String(init?.body))).toEqual({
            name: "get-treasury-stats",
            input: {},
          });
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ data: { asOf: "2026-02-25T00:00:00.000Z" } }),
          };
        }
        return {
          ok: false,
          status: 500,
          text: async () => JSON.stringify({ ok: false, error: "Unexpected URL" }),
        };
      },
    });

    await runCli(["tools", "get-treasury-stats"], harness.deps);
    expect(parseLastJsonOutput(harness.outputs)).toEqual({
      ok: true,
      data: { asOf: "2026-02-25T00:00:00.000Z" },
    });
  });

  it("docs errors when canonical tool routes are unavailable", async () => {
    const harness = createHarness({
      config: {
        url: "https://interface.example",
        token: "bbt_secret",
      },
      fetchResponder: async (input) => {
        const url = String(input);
        if (url.endsWith("/v1/tools") || url.endsWith("/v1/tool-executions")) {
          return {
            ok: false,
            status: 404,
            text: async () => JSON.stringify({ ok: false, error: "Not found" }),
          };
        }
        return {
          ok: false,
          status: 500,
          text: async () => JSON.stringify({ ok: false, error: "Unexpected URL" }),
        };
      },
    });

    await expect(runCli(["docs", "setup", "approval"], harness.deps)).rejects.toThrow(
      "Request failed (status 404): Not found"
    );

    expect(
      harness.fetchMock.mock.calls.some(([input]) => String(input).endsWith("/api/docs/search"))
    ).toBe(false);
  });

  it("tools get-user errors when canonical tool routes are unavailable", async () => {
    const harness = createHarness({
      config: {
        url: "https://interface.example",
        token: "bbt_secret",
      },
      fetchResponder: async (input) => {
        const url = String(input);
        if (url.endsWith("/v1/tools") || url.endsWith("/v1/tool-executions")) {
          return {
            ok: false,
            status: 404,
            text: async () => JSON.stringify({ ok: false, error: "Not found" }),
          };
        }
        return {
          ok: false,
          status: 500,
          text: async () => JSON.stringify({ ok: false, error: "Unexpected URL" }),
        };
      },
    });

    await expect(runCli(["tools", "get-user", "alice"], harness.deps)).rejects.toThrow(
      "Request failed (status 404): Not found"
    );

    expect(
      harness.fetchMock.mock.calls.some(([input]) =>
        String(input).endsWith("/api/buildbot/tools/get-user")
      )
    ).toBe(false);
  });

  it("farcaster command requires a subcommand", async () => {
    const harness = createHarness();
    await runCli(["farcaster"], harness.deps);
    expect(harness.outputs[0]).toContain("cli farcaster");
  });

  it("farcaster command supports --help and rejects unknown subcommands", async () => {
    const harness = createHarness();
    await runCli(["farcaster", "--help"], harness.deps);
    expect(harness.outputs[0]).toContain("cli farcaster");
    await expect(runCli(["farcaster", "unknown"], harness.deps)).rejects.toThrow(
      "Unknown farcaster subcommand: unknown"
    );
  });

  it("farcaster signup posts signer key and stores signer secret on success", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
        agent: "stored-agent",
      },
      fetchResponder: createJsonResponder({
        ok: true,
        result: {
          status: "complete",
          network: "optimism",
          ownerAddress: "0x0000000000000000000000000000000000000001",
          custodyAddress: "0x0000000000000000000000000000000000000002",
          recoveryAddress: "0x0000000000000000000000000000000000000001",
          fid: "123",
          idGatewayPriceWei: "7000000000000000",
          registerTxHash: "0xregister",
          addKeyTxHash: "0xadd",
        },
      }),
    });

    await runCli(["farcaster", "signup"], harness.deps);

    const [input, init] = harness.fetchMock.mock.calls[0];
    expect(String(input)).toBe("https://api.example/api/buildbot/farcaster/signup");
    const body = JSON.parse(String(init?.body)) as {
      signerPublicKey: string;
      recoveryAddress?: string;
    };
    expect(body.signerPublicKey).toMatch(/^0x[0-9a-f]{64}$/);
    expect(body.recoveryAddress).toBeUndefined();

    const output = parseLastJsonOutput(harness.outputs) as {
      signer?: { publicKey?: string; saved?: boolean; file?: string };
    };
    expect(output.signer).toEqual({
      publicKey: body.signerPublicKey,
      saved: true,
      file: "ed25519-signer.json",
    });

    const signerPath = "/tmp/cli-tests/.cobuild-cli/agents/stored-agent/farcaster/ed25519-signer.json";
    const secretsPath = "/tmp/cli-tests/.cobuild-cli/secrets.json";
    const savedSigner = JSON.parse(harness.files.get(signerPath) ?? "{}") as {
      publicKey?: string;
      signerRef?: { source?: string; provider?: string; id?: string };
      fid?: string;
      network?: string;
    };
    expect(savedSigner.publicKey).toBe(body.signerPublicKey);
    expect(savedSigner.signerRef).toEqual({
      source: "file",
      provider: "default",
      id: "/farcaster:ed25519:stored-agent:signer",
    });
    expect(savedSigner.fid).toBe("123");
    expect(savedSigner.network).toBe("optimism");
    expect(JSON.parse(harness.files.get(secretsPath) ?? "{}")).toMatchObject({
      "farcaster:ed25519:stored-agent:signer": expect.stringMatching(/^0x[0-9a-f]{64}$/),
    });
  });

  it("farcaster signup supports recovery and does not persist signer on needs_funding", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
      fetchResponder: createJsonResponder({
        ok: true,
        result: {
          status: "needs_funding",
          network: "optimism",
          ownerAddress: "0x0000000000000000000000000000000000000001",
          custodyAddress: "0x0000000000000000000000000000000000000002",
          recoveryAddress: "0x0000000000000000000000000000000000000009",
          idGatewayPriceWei: "7000000000000000",
          idGatewayPriceEth: "0.007",
          balanceWei: "0",
          balanceEth: "0",
          requiredWei: "7200000000000000",
          requiredEth: "0.0072",
        },
      }),
    });

    await runCli(
      [
        "farcaster",
        "signup",
        "--recovery",
        "0x0000000000000000000000000000000000000009",
      ],
      harness.deps
    );

    const [, init] = harness.fetchMock.mock.calls[0];
    const body = JSON.parse(String(init?.body)) as {
      signerPublicKey: string;
      recoveryAddress?: string;
    };
    expect(body.recoveryAddress).toBe("0x0000000000000000000000000000000000000009");

    const output = parseLastJsonOutput(harness.outputs) as {
      signer?: { publicKey?: string; saved?: boolean; file?: string };
    };
    expect(output.signer).toEqual({
      publicKey: body.signerPublicKey,
      saved: false,
      file: "ed25519-signer.json",
    });

    const signerPath = "/tmp/cli-tests/.cobuild-cli/agents/default/farcaster/ed25519-signer.json";
    expect(harness.files.get(signerPath)).toBeUndefined();
  });

  it("farcaster signup validates extra storage and recovery address", async () => {
    const harness = createHarness();
    await expect(
      runCli(["farcaster", "signup", "--extra-storage", "-1"], harness.deps)
    ).rejects.toThrow("--extra-storage must be a non-negative integer");
    await expect(
      runCli(["farcaster", "signup", "--recovery", "0xdeadbeef"], harness.deps)
    ).rejects.toThrow("--recovery must be a 20-byte hex address");
  });

  it("farcaster signup passes extra storage and custom signer output directory", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
      fetchResponder: createJsonResponder({
        ok: true,
        result: {
          status: "complete",
          network: "optimism",
          ownerAddress: "0x0000000000000000000000000000000000000001",
          custodyAddress: "0x0000000000000000000000000000000000000002",
          recoveryAddress: "0x0000000000000000000000000000000000000001",
        },
      }),
    });

    await runCli(
      [
        "farcaster",
        "signup",
        "--extra-storage",
        "2",
        "--out-dir",
        "/tmp/cli-tests/custom-farcaster",
      ],
      harness.deps
    );

    const [, init] = harness.fetchMock.mock.calls[0];
    const body = JSON.parse(String(init?.body)) as {
      signerPublicKey: string;
      extraStorage?: string;
    };
    expect(body.extraStorage).toBe("2");

    const signerPath = "/tmp/cli-tests/custom-farcaster/ed25519-signer.json";
    expect(harness.files.get(signerPath)).toBeTruthy();
  });

  it("farcaster signup validates out-dir and reports existing fid/custody on 409", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
      fetchResponder: createJsonResponder(
        {
          ok: false,
          error: "Farcaster account already exists for this agent wallet (fid: 77).",
          details: {
            fid: "77",
            custodyAddress: "0x0000000000000000000000000000000000000002",
          },
        },
        409
      ),
    });

    await expect(
      runCli(["farcaster", "signup", "--out-dir", "   "], createHarness().deps)
    ).rejects.toThrow("--out-dir cannot be empty");

    await expect(runCli(["farcaster", "signup"], harness.deps)).rejects.toThrow(
      "Farcaster account already exists for this agent wallet (fid=77, custodyAddress=0x0000000000000000000000000000000000000002). Use a different --agent key for a new Farcaster signup."
    );
  });

  it("send validates required positionals", async () => {
    const harness = createHarness();
    await expect(runCli(["send", "usdc", "1.0"], harness.deps)).rejects.toThrow(
      "Usage: cli send <token> <amount> <to> [--network] [--decimals] [--agent] [--idempotency-key]"
    );
  });

  it("send validates decimals", async () => {
    const harness = createHarness();
    await expect(
      runCli(["send", "usdc", "1.0", VALID_TO, "--decimals", "1.1"], harness.deps)
    ).rejects.toThrow("--decimals must be an integer");
  });

  it("send validates decimals bounds", async () => {
    const harness = createHarness();
    await expect(
      runCli(["send", "usdc", "1.0", VALID_TO, "--decimals", "256"], harness.deps)
    ).rejects.toThrow("--decimals must be between 0 and 255");
  });

  it("send validates amount and to address", async () => {
    const harness = createHarness();
    await expect(runCli(["send", "usdc", "1e3", VALID_TO], harness.deps)).rejects.toThrow(
      "amount must be a non-negative decimal string"
    );
    await expect(
      runCli(["send", "usdc", "1.0", "0xdeadbeef", "--idempotency-key", EXPLICIT_UUID], harness.deps)
    ).rejects.toThrow("to must be a 20-byte hex address");
  });

  it("send rejects invalid idempotency keys", async () => {
    const harness = createHarness();
    await expect(
      runCli(
        ["send", "usdc", "1.0", VALID_TO, "--idempotency-key", "not-a-uuid"],
        harness.deps
      )
    ).rejects.toThrow("Idempotency key must be a UUID v4");
  });

  it("send posts transfer payload and adds generated idempotency key", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
        agent: "stored-agent",
      },
      fetchResponder: createJsonResponder({ ok: true, txHash: "0x1" }),
    });

    await runCli(
      [
        "send",
        "usdc",
        "0.50",
        "0x000000000000000000000000000000000000dEaD",
        "--network",
        "base",
        "--decimals",
        "6",
      ],
      harness.deps
    );

    const [input, init] = harness.fetchMock.mock.calls[0];
    expect(String(input)).toBe("https://api.example/api/buildbot/exec");
    expect(init?.headers).toMatchObject({
      "X-Idempotency-Key": GENERATED_UUID,
      "Idempotency-Key": GENERATED_UUID,
      authorization: "Bearer bbt_secret",
    });

    expect(JSON.parse(String(init?.body))).toEqual({
      kind: "transfer",
      network: "base",
      agentKey: "stored-agent",
      token: "usdc",
      amount: "0.50",
      to: "0x000000000000000000000000000000000000dEaD",
      decimals: 6,
    });

    expect(parseLastJsonOutput(harness.outputs)).toEqual({
      idempotencyKey: GENERATED_UUID,
      ok: true,
      txHash: "0x1",
    });
    expect(harness.errors).toEqual([]);
  });

  it("tx requires --to and --data", async () => {
    const harness = createHarness();
    await expect(runCli(["tx", "--to", VALID_TO], harness.deps)).rejects.toThrow(
      "Usage: cli tx --to <address> --data <hex> [--value] [--network] [--agent] [--idempotency-key]"
    );
  });

  it("tx validates address, calldata, and value", async () => {
    const harness = createHarness();
    await expect(runCli(["tx", "--to", "0xabc", "--data", "0xdeadbeef"], harness.deps)).rejects.toThrow(
      "--to must be a 20-byte hex address"
    );
    await expect(runCli(["tx", "--to", VALID_TO, "--data", "0xabc"], harness.deps)).rejects.toThrow(
      "--data must be a hex string with even length"
    );
    await expect(
      runCli(["tx", "--to", VALID_TO, "--data", "0xdeadbeef", "--value", "abc"], harness.deps)
    ).rejects.toThrow("--value must be a non-negative decimal string");
  });

  it("tx supports explicit idempotency key and default value", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
      fetchResponder: createJsonResponder({ ok: true, hash: "0x2" }),
    });

    await runCli(
      [
        "tx",
        "--to",
        VALID_TO,
        "--data",
        "0xdeadbeef",
        "--idempotency-key",
        EXPLICIT_UUID,
        "--agent",
        "manual-agent",
      ],
      harness.deps
    );

    const [input, init] = harness.fetchMock.mock.calls[0];
    expect(String(input)).toBe("https://api.example/api/buildbot/exec");
    expect(init?.headers).toMatchObject({
      "X-Idempotency-Key": EXPLICIT_UUID,
      "Idempotency-Key": EXPLICIT_UUID,
    });

    expect(JSON.parse(String(init?.body))).toEqual({
      kind: "tx",
      network: "base-sepolia",
      agentKey: "manual-agent",
      to: VALID_TO,
      data: "0xdeadbeef",
      valueEth: "0",
    });

    expect(parseLastJsonOutput(harness.outputs)).toEqual({
      idempotencyKey: EXPLICIT_UUID,
      ok: true,
      hash: "0x2",
    });
    expect(harness.errors).toEqual([]);
  });

  it("tx rejects invalid idempotency keys", async () => {
    const harness = createHarness();
    await expect(
      runCli(
        ["tx", "--to", VALID_TO, "--data", "0xdeadbeef", "--idempotency-key", "custom-key"],
        harness.deps
      )
    ).rejects.toThrow("Idempotency key must be a UUID v4");
  });

  it("runCliFromProcess includes send idempotency key when request fails", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
      fetchResponder: createJsonResponder({ ok: false, error: "backend unavailable" }, 503),
    });

    await runCliFromProcess(["node", "cli", "send", "usdc", "1.0", VALID_TO], harness.deps);

    expect(harness.errors[0]).toContain("Request failed (status 503): backend unavailable");
    expect(harness.errors[0]).toContain(`idempotency key: ${GENERATED_UUID}`);
    expect(harness.exitCodes).toEqual([1]);
  });

  it("runCliFromProcess includes tx idempotency key when request fails", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
      fetchResponder: createJsonResponder({ ok: false, error: "backend unavailable" }, 503),
    });

    await runCliFromProcess(
      ["node", "cli", "tx", "--to", VALID_TO, "--data", "0xdeadbeef"],
      harness.deps
    );

    expect(harness.errors[0]).toContain("Request failed (status 503): backend unavailable");
    expect(harness.errors[0]).toContain(`idempotency key: ${GENERATED_UUID}`);
    expect(harness.exitCodes).toEqual([1]);
  });

  it("uses default agent when none is set", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
      fetchResponder: createJsonResponder({ ok: true }),
    });

    await runCli(["wallet"], harness.deps);

    const [, init] = harness.fetchMock.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual({
      agentKey: "default",
    });
  });

  it("runCliFromProcess handles thrown values", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
    });
    const deps = {
      ...harness.deps,
      fetch: async () => {
        throw "non-error";
      },
    };

    await runCliFromProcess(["node", "cli", "wallet"], deps);

    expect(harness.errors[0]).toBe("Error: non-error");
    expect(harness.exitCodes).toEqual([1]);
  });

  it("runCliFromProcess prints unknown command errors", async () => {
    const harness = createHarness();
    await runCliFromProcess(["node", "cli", "nope"], harness.deps);

    expect(harness.errors[0]).toBe("Error: Unknown command: nope");
    expect(harness.exitCodes).toEqual([1]);
  });
});
