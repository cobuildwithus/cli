import { describe, expect, it } from "vitest";
import { createCliDeps, runCli, runCliFromProcess } from "../src/cli.js";
import { createHarness } from "./helpers.js";

const GENERATED_UUID = "8e03978e-40d5-43e8-bc93-6894a57f9324";
const EXPLICIT_UUID = "75d6e51f-4f27-4f17-b32f-4708fdb0f3be";

function parseLastJsonOutput(outputs: string[]): unknown {
  return JSON.parse(outputs.at(-1) ?? "null");
}

function createJsonResponder(body: unknown, status = 200) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  });
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
    expect(harness.outputs[0]).toContain("buildbot");
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
      url: "https://api.example",
      token: "abcdefgh...",
      agent: "ops",
      path: harness.configFile,
    });
  });

  it("config without subcommand prints usage", async () => {
    const harness = createHarness();
    await runCli(["config"], harness.deps);
    expect(harness.outputs[0]).toContain("Usage:");
  });

  it("config set requires at least one value", async () => {
    const harness = createHarness();
    await expect(runCli(["config", "set"], harness.deps)).rejects.toThrow(
      "Usage: buildbot config set --url <interface-url> --token <pat>|--token-file <path>|--token-stdin [--agent <key>]"
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
      url: null,
      token: null,
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
      url: "https://api.example",
      token: "next-tok...",
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
        url: "https://api.example",
        agent: "default",
        path: harness.configFile,
      },
      defaultNetwork: "base-sepolia",
      wallet: { ok: true, address: "0xabc" },
      next: [
        "Run: buildbot wallet",
        "Run: buildbot send usdc 0.10 <to> (or buildbot send eth 0.00001 <to>)",
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
        url: "https://api.example",
        agent: "default",
        path: harness.configFile,
      },
      defaultNetwork: "base-sepolia",
      wallet: { ok: true, address: "0xabc" },
      next: [
        "Run: buildbot wallet",
        "Run: buildbot send usdc 0.10 <to> (or buildbot send eth 0.00001 <to>)",
      ],
    });
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
      "Wallet bootstrap failed on the interface server. Check interface logs, run the Build Bot SQL migrations, and verify CDP env vars are set (CDP_API_KEY_ID, CDP_API_KEY_SECRET, CDP_WALLET_SECRET)."
    );

    expect(JSON.parse(harness.files.get(harness.configFile) ?? "{}")).toEqual({
      url: "https://api.example",
      token: "bbt_secret",
      agent: "default",
    });
  });

  it("setup requires url in non-interactive mode when none is configured", async () => {
    const harness = createHarness();
    await expect(runCli(["setup", "--token", "bbt_secret"], harness.deps)).rejects.toThrow(
      "Missing --url and no config found."
    );
  });

  it("setup requires token in non-interactive mode when none is configured", async () => {
    const harness = createHarness();
    await expect(runCli(["setup", "--url", "https://api.example"], harness.deps)).rejects.toThrow(
      "Missing --token and no config found."
    );
  });

  it("setup uses configured values and BUILD_BOT_NETWORK fallback", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
        agent: "stored-agent",
      },
      fetchResponder: createJsonResponder({ ok: true, address: "0xdef" }),
    });

    const previous = process.env.BUILD_BOT_NETWORK;
    process.env.BUILD_BOT_NETWORK = "base";

    try {
      await runCli(["setup"], harness.deps);
    } finally {
      if (previous === undefined) {
        delete process.env.BUILD_BOT_NETWORK;
      } else {
        process.env.BUILD_BOT_NETWORK = previous;
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

  it("send validates required positionals", async () => {
    const harness = createHarness();
    await expect(runCli(["send", "usdc", "1.0"], harness.deps)).rejects.toThrow(
      "Usage: buildbot send <token> <amount> <to> [--network] [--decimals] [--agent] [--idempotency-key]"
    );
  });

  it("send validates decimals", async () => {
    const harness = createHarness();
    await expect(
      runCli(["send", "usdc", "1.0", "0xabc", "--decimals", "1.1"], harness.deps)
    ).rejects.toThrow("--decimals must be an integer");
  });

  it("send validates decimals bounds", async () => {
    const harness = createHarness();
    await expect(
      runCli(["send", "usdc", "1.0", "0xabc", "--decimals", "256"], harness.deps)
    ).rejects.toThrow("--decimals must be between 0 and 255");
  });

  it("send rejects invalid idempotency keys", async () => {
    const harness = createHarness();
    await expect(
      runCli(
        ["send", "usdc", "1.0", "0xabc", "--idempotency-key", "not-a-uuid"],
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
    await expect(runCli(["tx", "--to", "0xabc"], harness.deps)).rejects.toThrow(
      "Usage: buildbot tx --to <address> --data <hex> [--value] [--network] [--agent] [--idempotency-key]"
    );
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
        "0xabc",
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
      to: "0xabc",
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
      runCli(["tx", "--to", "0xabc", "--data", "0xdeadbeef", "--idempotency-key", "custom-key"], harness.deps)
    ).rejects.toThrow("Idempotency key must be a UUID v4");
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

    await runCliFromProcess(["node", "buildbot", "wallet"], deps);

    expect(harness.errors[0]).toBe("Error: non-error");
    expect(harness.exitCodes).toEqual([1]);
  });

  it("runCliFromProcess prints unknown command errors", async () => {
    const harness = createHarness();
    await runCliFromProcess(["node", "buildbot", "nope"], harness.deps);

    expect(harness.errors[0]).toBe("Error: Unknown command: nope");
    expect(harness.exitCodes).toEqual([1]);
  });
});
