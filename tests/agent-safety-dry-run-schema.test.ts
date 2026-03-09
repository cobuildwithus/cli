import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";
import { createHarness } from "./helpers.js";

const GENERATED_UUID = "8e03978e-40d5-43e8-bc93-6894a57f9324";
const VALID_TO = "0x000000000000000000000000000000000000dead";

function parseLastJsonOutput(outputs: string[]): unknown {
  return JSON.parse(outputs.at(-1) ?? "null");
}

function setFarcasterSignerFixture(
  harness: ReturnType<typeof createHarness>,
  agentKey = "default",
  fid = 1234
): void {
  const signerRefId = `/farcaster:ed25519:${agentKey}:signer`;
  harness.files.set(
    `/tmp/cli-tests/.cobuild-cli/agents/${agentKey}/farcaster/ed25519-signer.json`,
    JSON.stringify(
      {
        version: 2,
        algorithm: "ed25519",
        publicKey: `0x${"11".repeat(32)}`,
        signerRef: {
          source: "file",
          provider: "default",
          id: signerRefId,
        },
        fid,
        custodyAddress: "0x0000000000000000000000000000000000000001",
        network: "optimism",
        createdAt: "2026-03-05T00:00:00.000Z",
      },
      null,
      2
    )
  );

  harness.files.set(
    "/tmp/cli-tests/.cobuild-cli/secrets.json",
    JSON.stringify(
      {
        [`farcaster:ed25519:${agentKey}:signer`]: `0x${"22".repeat(32)}`,
      },
      null,
      2
    )
  );
}

describe("agent safety + dry-run + schema", () => {
  it("rejects unsafe agent keys for config updates and runtime commands", async () => {
    const configHarness = createHarness();
    await expect(runCli(["config", "set", "--agent", "../../x"], configHarness.deps)).rejects.toThrow(
      "--agent must not contain path separators."
    );

    const walletHarness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
    });
    await expect(runCli(["wallet", "--agent", ".."], walletHarness.deps)).rejects.toThrow(
      'agent key must not be "." or "..".'
    );
    expect(walletHarness.fetchMock).not.toHaveBeenCalled();

    const farcasterHarness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
    });
    await expect(
      runCli(["farcaster", "post", "--text", "hello", "--agent", "a/b"], farcasterHarness.deps)
    ).rejects.toThrow("agent key must not contain path separators.");
    expect(farcasterHarness.fetchMock).not.toHaveBeenCalled();
  });

  it("rejects explicit empty --agent values instead of silently falling back", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
        agent: "stored-agent",
      },
    });

    await expect(runCli(["wallet", "--agent="], harness.deps)).rejects.toThrow(
      "agent key cannot be empty."
    );
    expect(harness.fetchMock).not.toHaveBeenCalled();
  });

  it("supports headless auth token refs in config set", async () => {
    const envHarness = createHarness();
    await runCli(["config", "set", "--token-env", "COBUILD_REFRESH_TOKEN"], envHarness.deps);
    await runCli(["config", "show"], envHarness.deps);
    expect(parseLastJsonOutput(envHarness.outputs)).toMatchObject({
      tokenRef: {
        source: "env",
        provider: "default",
        id: "COBUILD_REFRESH_TOKEN",
      },
    });

    const execHarness = createHarness({
      config: {
        secrets: {
          providers: {
            exec1: {
              source: "exec",
              command: "/tmp/exec-provider",
            },
          },
          defaults: {
            exec: "exec1",
          },
        },
      },
    });
    await runCli(["config", "set", "--token-exec", "exec1:refresh-token"], execHarness.deps);
    await runCli(["config", "show"], execHarness.deps);
    expect(parseLastJsonOutput(execHarness.outputs)).toMatchObject({
      tokenRef: {
        source: "exec",
        provider: "exec1",
        id: "refresh-token",
      },
    });
  });

  it("supports dry-run and JSON input for send/tx without network calls", async () => {
    const sendHarness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
        agent: "stored-agent",
      },
    });

    await runCli(["send", "usdc", "1.25", VALID_TO, "--dry-run"], sendHarness.deps);
    expect(sendHarness.fetchMock).not.toHaveBeenCalled();
    expect(parseLastJsonOutput(sendHarness.outputs)).toMatchObject({
      ok: true,
      dryRun: true,
      idempotencyKey: GENERATED_UUID,
      request: {
        method: "POST",
        path: "/api/cli/exec",
        body: {
          kind: "transfer",
          network: "base",
          agentKey: "stored-agent",
          token: "usdc",
          amount: "1.25",
          to: VALID_TO,
        },
      },
    });

    const sendJsonHarness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
    });

    await runCli(
      [
        "send",
        "--input-json",
        JSON.stringify({
          token: "usdc",
          amount: "0.75",
          to: VALID_TO,
          network: "base-sepolia",
          decimals: 6,
          agent: "ops",
          idempotencyKey: "75d6e51f-4f27-4f17-b32f-4708fdb0f3be",
        }),
        "--dry-run",
      ],
      sendJsonHarness.deps
    );

    expect(sendJsonHarness.fetchMock).not.toHaveBeenCalled();
    expect(parseLastJsonOutput(sendJsonHarness.outputs)).toMatchObject({
      dryRun: true,
      request: {
        body: {
          kind: "transfer",
          network: "base-sepolia",
          agentKey: "ops",
          token: "usdc",
          amount: "0.75",
          to: VALID_TO,
          decimals: 6,
        },
      },
    });

    const txHarness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
    });

    await runCli(
      [
        "tx",
        "--input-json",
        JSON.stringify({
          to: VALID_TO,
          data: "0xdeadbeef",
          value: "0",
          network: "base-sepolia",
          agent: "ops",
          idempotencyKey: "75d6e51f-4f27-4f17-b32f-4708fdb0f3be",
        }),
        "--dry-run",
      ],
      txHarness.deps
    );

    expect(txHarness.fetchMock).not.toHaveBeenCalled();
    expect(parseLastJsonOutput(txHarness.outputs)).toMatchObject({
      ok: true,
      dryRun: true,
      idempotencyKey: "75d6e51f-4f27-4f17-b32f-4708fdb0f3be",
      request: {
        method: "POST",
        path: "/api/cli/exec",
        body: {
          kind: "tx",
          network: "base-sepolia",
          agentKey: "ops",
          to: VALID_TO,
          data: "0xdeadbeef",
          valueEth: "0",
        },
      },
    });
  });

  it("supports --input-file/--input-stdin for send and tx dry-run paths", async () => {
    const sendHarness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
    });
    const sendInputPath = "/tmp/cli-tests/send-input.json";
    sendHarness.files.set(
      sendInputPath,
      JSON.stringify({
        token: "usdc",
        amount: "3.5",
        to: VALID_TO,
        network: "base-sepolia",
        decimals: "6",
        agent: "from-file",
      })
    );

    await runCli(["send", "--input-file", sendInputPath, "--dry-run"], sendHarness.deps);
    expect(sendHarness.fetchMock).not.toHaveBeenCalled();
    expect(parseLastJsonOutput(sendHarness.outputs)).toMatchObject({
      dryRun: true,
      request: {
        body: {
          kind: "transfer",
          network: "base-sepolia",
          agentKey: "from-file",
          token: "usdc",
          amount: "3.5",
          to: VALID_TO,
          decimals: 6,
        },
      },
    });

    const txHarness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
    });
    txHarness.deps.readStdin = async () =>
      JSON.stringify({
        to: VALID_TO,
        data: "0xdeadbeef",
        value: "0.01",
        agent: "from-stdin",
      });

    await runCli(["tx", "--input-stdin", "--dry-run"], txHarness.deps);
    expect(txHarness.fetchMock).not.toHaveBeenCalled();
    expect(parseLastJsonOutput(txHarness.outputs)).toMatchObject({
      dryRun: true,
      idempotencyKey: GENERATED_UUID,
      request: {
        body: {
          kind: "tx",
          network: "base",
          agentKey: "from-stdin",
          to: VALID_TO,
          data: "0xdeadbeef",
          valueEth: "0.01",
        },
      },
    });
  });

  it("validates send --input-json fields with deterministic errors", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
    });

    await expect(
      runCli(
        [
          "send",
          "--input-json",
          JSON.stringify({
            amount: "1",
            to: VALID_TO,
          }),
          "--dry-run",
        ],
        harness.deps
      )
    ).rejects.toThrow('send input "token" must be a non-empty string.');

    await expect(
      runCli(
        [
          "send",
          "--input-json",
          JSON.stringify({
            token: "usdc",
            amount: "1",
            to: VALID_TO,
            network: 1,
          }),
          "--dry-run",
        ],
        harness.deps
      )
    ).rejects.toThrow('send input "network" must be a non-empty string when provided.');

    await expect(
      runCli(
        [
          "send",
          "--input-json",
          JSON.stringify({
            token: "usdc",
            amount: "1",
            to: VALID_TO,
            decimals: 6.5,
          }),
          "--dry-run",
        ],
        harness.deps
      )
    ).rejects.toThrow('send input "decimals" must be an integer.');

    await expect(
      runCli(
        [
          "send",
          "--input-json",
          JSON.stringify({
            token: "usdc",
            amount: "1",
            to: VALID_TO,
            decimals: false,
          }),
          "--dry-run",
        ],
        harness.deps
      )
    ).rejects.toThrow('send input "decimals" must be a string or integer.');
  });

  it("validates tx --input-json fields with deterministic errors", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
    });

    await expect(
      runCli(
        [
          "tx",
          "--input-json",
          JSON.stringify({
            data: "0xdeadbeef",
          }),
          "--dry-run",
        ],
        harness.deps
      )
    ).rejects.toThrow('tx input "to" must be a non-empty string.');

    await expect(
      runCli(
        [
          "tx",
          "--input-json",
          JSON.stringify({
            to: VALID_TO,
            data: "0xdeadbeef",
            network: 1,
          }),
          "--dry-run",
        ],
        harness.deps
      )
    ).rejects.toThrow('tx input "network" must be a non-empty string when provided.');

    await expect(
      runCli(
        [
          "tx",
          "--input-json",
          JSON.stringify({
            to: VALID_TO,
            data: "0xdeadbeef",
            value: "  ",
          }),
          "--dry-run",
        ],
        harness.deps
      )
    ).rejects.toThrow('tx input "value" must be a non-empty string when provided.');
  });

  it("rejects mixing send positional args with --input-json", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
    });

    await expect(
      runCli(
        [
          "send",
          "usdc",
          "1",
          VALID_TO,
          "--input-json",
          JSON.stringify({
            token: "usdc",
            amount: "1",
            to: VALID_TO,
          }),
        ],
        harness.deps
      )
    ).rejects.toThrow(
      "Do not combine --input-json, --input-file, or --input-stdin with positional arguments or send flags."
    );
  });

  it("rejects conflicting JSON input sources and tx flag mixing", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
    });
    const txInputPath = "/tmp/cli-tests/tx-input.json";
    harness.files.set(
      txInputPath,
      JSON.stringify({
        to: VALID_TO,
        data: "0xdeadbeef",
      })
    );

    await expect(
      runCli(["send", "--input-json", "{}", "--input-file", txInputPath, "--dry-run"], harness.deps)
    ).rejects.toThrow("Provide only one of --input-file, --input-json, or --input-stdin.");

    await expect(
      runCli(["tx", "--input-file", txInputPath, "--input-stdin", "--dry-run"], harness.deps)
    ).rejects.toThrow("Provide only one of --input-file, --input-json, or --input-stdin.");

    await expect(
      runCli(
        [
          "tx",
          "--to",
          VALID_TO,
          "--data",
          "0xdeadbeef",
          "--input-json",
          JSON.stringify({
            to: VALID_TO,
            data: "0xdeadbeef",
          }),
        ],
        harness.deps
      )
    ).rejects.toThrow("Do not combine --input-json, --input-file, or --input-stdin with tx flags.");
  });

  it("returns side-effect-free dry-run plans for farcaster post", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
    });
    setFarcasterSignerFixture(harness);

    await runCli(["farcaster", "post", "--text", "hello", "--dry-run"], harness.deps);

    const output = parseLastJsonOutput(harness.outputs) as {
      dryRun?: boolean;
      idempotencyKey?: string;
      request?: Record<string, unknown>;
    };

    expect(output.dryRun).toBe(true);
    expect(output.idempotencyKey).toBe(GENERATED_UUID);
    expect(output.request).toMatchObject({
      kind: "farcaster.post",
      agentKey: "default",
      text: "hello",
      verifyMode: "none",
    });
    expect(harness.fetchMock).not.toHaveBeenCalled();
    expect(
      harness.files.has(`/tmp/cli-tests/.cobuild-cli/agents/default/farcaster/posts/${GENERATED_UUID}.json`)
    ).toBe(false);
  });

  it("supports command-level schema introspection", async () => {
    const harness = createHarness();

    await runCli(["schema", "wallet"], harness.deps);
    expect(parseLastJsonOutput(harness.outputs)).toMatchObject({
      ok: true,
      command: "wallet",
      schema: {
        output: {
          properties: {
            walletConfig: expect.any(Object),
          },
        },
      },
      metadata: {
        mutating: true,
        supportsDryRun: false,
      },
    });

    await runCli(["schema", "farcaster", "post"], harness.deps);
    expect(parseLastJsonOutput(harness.outputs)).toMatchObject({
      ok: true,
      command: "farcaster post",
      metadata: {
        mutating: true,
        supportsDryRun: true,
      },
    });
  });

  it("returns deterministic schema errors for blank and unknown command paths", async () => {
    const harness = createHarness();

    await expect(runCli(["schema", "   "], harness.deps)).rejects.toThrow(
      "Usage: cli schema <command path>"
    );
    await expect(runCli(["schema", "missing", "command"], harness.deps)).rejects.toThrow(
      'Unknown command path "missing command".'
    );
  });

  it("validates config token-ref option edge cases", async () => {
    const harness = createHarness();
    await expect(runCli(["config", "set", "--token-ref-json", ""], harness.deps)).rejects.toThrow(
      "--token-ref-json cannot be empty."
    );

    await expect(
      runCli(["config", "set", "--token-ref-json", "{not-json}"], harness.deps)
    ).rejects.toThrow("--token-ref-json must be valid JSON:");

    await expect(
      runCli(["config", "set", "--token-exec", "missing:token"], harness.deps)
    ).rejects.toThrow('is not configured as an exec secret provider.');

    await expect(runCli(["config", "set", "--token-env", "1INVALID"], harness.deps)).rejects.toThrow(
      "--token-env must be a valid environment variable name."
    );

    await expect(
      runCli(
        [
          "config",
          "set",
          "--token-env",
          "COBUILD_TOKEN_A",
          "--token-ref-json",
          JSON.stringify({
            source: "env",
            provider: "default",
            id: "COBUILD_TOKEN_B",
          }),
        ],
        harness.deps
      )
    ).rejects.toThrow(
      "Provide only one token source: --token, --token-file, --token-stdin, --token-env, --token-exec, or --token-ref-json."
    );
  });

  it("handles invalid legacy interface URLs when rotating config url", async () => {
    const harness = createHarness({
      config: {
        url: "not-a-url",
        token: "bbt_secret",
      },
    });

    await runCli(["config", "set", "--url", "https://other.example"], harness.deps);
    await runCli(["config", "show"], harness.deps);

    expect(parseLastJsonOutput(harness.outputs)).toMatchObject({
      interfaceUrl: "https://other.example",
      chatApiUrl: "https://other.example",
      token: null,
      tokenRef: null,
    });
  });
});
