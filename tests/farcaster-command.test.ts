import { describe, expect, it } from "vitest";
import { Message } from "@farcaster/hub-nodejs";
import { runCli } from "../src/cli.js";
import { createHarness } from "./helpers.js";

function parseLastJsonOutput(outputs: string[]): unknown {
  return JSON.parse(outputs.at(-1) ?? "null");
}

/** Build a structurally valid x402 payment header that passes `validateX402PaymentPayload`. */
function mockXPayment(
  label = "mock",
  overrides?: {
    network?: string;
    to?: string;
    value?: string;
    validBefore?: string;
    includeAuthorization?: boolean;
  }
): string {
  const authorization = {
    from: "0x0000000000000000000000000000000000000001",
    to: overrides?.to ?? "0xa6a8736f18f383f1cc2d938576933e5ea7df01a1",
    value: overrides?.value ?? "1000",
    validAfter: "0",
    validBefore: overrides?.validBefore ?? "4102444800",
    nonce: "0x0000000000000000000000000000000000000000000000000000000000000001",
  };
  const payload = {
    x402Version: 1,
    scheme: "exact",
    network: overrides?.network ?? "base",
    payload:
      overrides?.includeAuthorization === false
        ? {
            signature: `0x${label}`,
          }
        : {
            signature: `0x${label}`,
            authorization,
          },
  };

  // Use a far-future validBefore so the value is stable across test runs.
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

function mutateXPayment(
  xPaymentBase64: string,
  mutate: (payload: Record<string, unknown>) => void
): string {
  const payload = JSON.parse(Buffer.from(xPaymentBase64, "base64").toString("utf-8")) as Record<
    string,
    unknown
  >;
  mutate(payload);
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

// Pre-built mock payment headers for stable assertions.
const MOCK_PAYMENT_1 = mockXPayment("payment-1");
const MOCK_PAYMENT_2 = mockXPayment("payment-2");
const MOCK_PAYMENT_RESUME = mockXPayment("payment-resume");
const MOCK_PAYMENT_VERIFY = mockXPayment("payment-verify");
const MOCK_PAYMENT_POLL = mockXPayment("payment-poll");
const MOCK_PAYMENT_POLL_FAIL = mockXPayment("payment-poll-fail");
const MOCK_PAYMENT_NONE = mockXPayment("payment-none");
const MOCK_PAYMENT_OVERRIDE = mockXPayment("payment-override");
const MOCK_PAYMENT_MIGRATE = mockXPayment("payment-migrate");
const MOCK_PAYMENT_TIMEOUT = mockXPayment("payment-timeout");
const MOCK_PAYMENT_REPLY = mockXPayment("reply-payment");

function createJsonResponder(body: unknown, status = 200) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  });
}

function setHostedX402PayerConfig(
  harness: ReturnType<typeof createHarness>,
  agentKey = "default",
  payerAddress = "0x0000000000000000000000000000000000000009"
): void {
  harness.files.set(
    `/tmp/cli-tests/.cobuild-cli/agents/${agentKey}/wallet/payer.json`,
    JSON.stringify(
      {
        version: 1,
        mode: "hosted",
        payerAddress,
        network: "base",
        token: "usdc",
        createdAt: "2026-03-02T00:00:00.000Z",
      },
      null,
      2
    )
  );
}

function setLocalX402PayerConfig(
  harness: ReturnType<typeof createHarness>,
  agentKey = "default"
): void {
  harness.files.set(
    `/tmp/cli-tests/.cobuild-cli/agents/${agentKey}/wallet/payer.json`,
    JSON.stringify(
      {
        version: 1,
        mode: "local",
        payerAddress: "0x87F6433eae757DF1f471bF9Ce03fe32d751eaE35",
        payerRef: {
          source: "file",
          provider: "default",
          id: `/wallet:payer:${agentKey}`,
        },
        network: "base",
        token: "usdc",
        createdAt: "2026-03-02T00:00:00.000Z",
      },
      null,
      2
    )
  );
  const secretsPath = "/tmp/cli-tests/.cobuild-cli/secrets.json";
  const existingSecretsRaw = harness.files.get(secretsPath);
  const existingSecrets = existingSecretsRaw ? JSON.parse(existingSecretsRaw) : {};
  harness.files.set(
    secretsPath,
    JSON.stringify(
      {
        ...existingSecrets,
        [`wallet:payer:${agentKey}`]: `0x${"01".repeat(31)}02`,
      },
      null,
      2
    )
  );
}

describe("farcaster command", () => {
  it("requires a subcommand, supports --help, and rejects unknown subcommands", async () => {
    const harness = createHarness();

    await runCli(["farcaster"], harness.deps);
    expect(harness.outputs[0]).toContain("cli farcaster");
    await runCli(["farcaster", "--help"], harness.deps);
    expect(harness.outputs.at(-1)).toContain("cli farcaster");
    await expect(runCli(["farcaster", "unknown"], harness.deps)).rejects.toThrow(
      "Unknown farcaster subcommand: unknown"
    );
  });

  it("validates wallet payer usage for missing/unknown actions", async () => {
    const harness = createHarness();
    await expect(runCli(["wallet", "payer"], harness.deps)).rejects.toThrow("cli wallet payer init");
    await expect(runCli(["wallet", "payer", "nope"], harness.deps)).rejects.toThrow(
      "cli wallet payer init"
    );
  });

  it("initializes x402 local-generate payer and persists secret ref", async () => {
    const harness = createHarness({
      config: {
        agent: "alice",
      },
    });

    await runCli(
      ["wallet", "payer", "init", "--mode", "local-generate", "--no-prompt"],
      harness.deps
    );

    const output = parseLastJsonOutput(harness.outputs) as {
      ok?: boolean;
      agentKey?: string;
      payer?: { mode?: string; payerAddress?: string | null };
    };
    expect(output.ok).toBe(true);
    expect(output.agentKey).toBe("alice");
    expect(output.payer?.mode).toBe("local");
    expect(output.payer?.payerAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);

    const payerPath = "/tmp/cli-tests/.cobuild-cli/agents/alice/wallet/payer.json";
    const payer = JSON.parse(harness.files.get(payerPath) ?? "{}") as {
      mode?: string;
      payerRef?: { source?: string; provider?: string; id?: string };
    };
    expect(payer.mode).toBe("local");
    expect(payer.payerRef).toEqual({
      source: "file",
      provider: "default",
      id: "/wallet:payer:alice",
    });
    const secrets = JSON.parse(harness.files.get("/tmp/cli-tests/.cobuild-cli/secrets.json") ?? "{}");
    expect(secrets["wallet:payer:alice"]).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("reports hosted payer status and refreshes missing payer address from backend wallet endpoint", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
        agent: "default",
      },
      fetchResponder: async (input) => {
        const url = String(input);
        if (url === "https://api.example/api/cli/wallet?agentKey=default") {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                ok: true,
                result: {
                  ownerAccountAddress: "0x00000000000000000000000000000000000000aa",
                },
              }),
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });
    harness.files.set(
      "/tmp/cli-tests/.cobuild-cli/agents/default/wallet/payer.json",
      JSON.stringify(
        {
          version: 1,
          mode: "hosted",
          payerAddress: null,
          network: "base",
          token: "usdc",
          createdAt: "2026-03-02T00:00:00.000Z",
        },
        null,
        2
      )
    );

    await runCli(["wallet", "payer", "status"], harness.deps);

    expect(parseLastJsonOutput(harness.outputs)).toMatchObject({
      ok: true,
      agentKey: "default",
      payer: {
        mode: "hosted",
        payerAddress: "0x00000000000000000000000000000000000000aa",
      },
    });

    const persisted = JSON.parse(
      harness.files.get("/tmp/cli-tests/.cobuild-cli/agents/default/wallet/payer.json") ?? "{}"
    ) as { payerAddress?: string | null };
    expect(persisted.payerAddress).toBe("0x00000000000000000000000000000000000000aa");
    expect(harness.fetchMock).toHaveBeenCalledTimes(1);
  });

  it("validates local-key payer init key source constraints", async () => {
    const harness = createHarness();

    await expect(
      runCli(
        [
          "wallet",
          "payer",
          "init",
          "--mode",
          "hosted",
          "--private-key-file",
          "/tmp/key.txt",
          "--no-prompt",
        ],
        harness.deps
      )
    ).rejects.toThrow("--private-key-stdin/--private-key-file require --mode local-key.");

    await expect(
      runCli(
        [
          "wallet",
          "payer",
          "init",
          "--mode",
          "local-key",
          "--private-key-stdin",
          "--private-key-file",
          "/tmp/key.txt",
          "--no-prompt",
        ],
        harness.deps
      )
    ).rejects.toThrow("Provide only one of --private-key-stdin or --private-key-file.");

    await expect(
      runCli(["wallet", "payer", "init", "--mode", "local-key", "--no-prompt"], harness.deps)
    ).rejects.toThrow(
      "local-key mode requires --private-key-stdin or --private-key-file in non-interactive mode."
    );

    harness.files.set("/tmp/key.txt", "not-a-key");
    await expect(
      runCli(
        [
          "wallet",
          "payer",
          "init",
          "--mode",
          "local-key",
          "--private-key-file",
          "/tmp/key.txt",
          "--no-prompt",
        ],
        harness.deps
      )
    ).rejects.toThrow("Private key must be 32 bytes hex (0x + 64 hex chars).");

    harness.files.set("/tmp/key-empty.txt", "\n");
    await expect(
      runCli(
        [
          "wallet",
          "payer",
          "init",
          "--mode",
          "local-key",
          "--private-key-file",
          "/tmp/key-empty.txt",
          "--no-prompt",
        ],
        harness.deps
      )
    ).rejects.toThrow("private key file is empty: /tmp/key-empty.txt");
  });

  it("supports local-key payer init from stdin in non-interactive mode", async () => {
    const harness = createHarness();
    harness.deps.readStdin = async () => `0x${"44".repeat(32)}\n`;

    await runCli(
      [
        "wallet",
        "payer",
        "init",
        "--agent",
        "stdin-agent",
        "--mode",
        "local-key",
        "--private-key-stdin",
        "--no-prompt",
      ],
      harness.deps
    );

    const output = parseLastJsonOutput(harness.outputs) as {
      payer?: { mode?: string; payerAddress?: string | null };
    };
    expect(output.payer?.mode).toBe("local");
    expect(output.payer?.payerAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("rejects unknown payer init mode values", async () => {
    const harness = createHarness();
    await expect(
      runCli(["wallet", "payer", "init", "--mode", "invalid", "--no-prompt"], harness.deps)
    ).rejects.toThrow("--mode must be one of: hosted, local-generate, local-key");
  });

  it("surfaces hosted payer init backend wallet failures", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
      fetchResponder: async () => ({
        ok: false,
        status: 500,
        text: async () => JSON.stringify({ ok: false, error: "internal error" }),
      }),
    });

    await expect(
      runCli(["wallet", "payer", "init", "--mode", "hosted", "--no-prompt"], harness.deps)
    ).rejects.toThrow("Hosted payer setup requires backend wallet access: Request failed (status 500): internal error");
  });

  it("rejects hosted payer init when backend wallet payload has invalid address shape", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
      fetchResponder: async () => ({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            ok: true,
            result: {
              ownerAccountAddress: "invalid-address",
            },
          }),
      }),
    });

    await expect(
      runCli(["wallet", "payer", "init", "--mode", "hosted", "--no-prompt"], harness.deps)
    ).rejects.toThrow(
      "Hosted payer setup requires backend wallet access: Backend wallet response returned invalid EVM address at result.ownerAccountAddress."
    );
  });

  it("rejects hosted payer init when backend wallet payload has invalid result.wallet.address", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
      fetchResponder: async () => ({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            ok: true,
            result: {
              wallet: {
                address: "invalid-address",
              },
            },
          }),
      }),
    });

    await expect(
      runCli(["wallet", "payer", "init", "--mode", "hosted", "--no-prompt"], harness.deps)
    ).rejects.toThrow(
      "Hosted payer setup requires backend wallet access: Backend wallet response returned invalid EVM address at result.wallet.address."
    );
  });

  it("rejects hosted payer init when backend wallet payload has invalid ownerAccountAddress", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
      fetchResponder: async () => ({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            ok: true,
            ownerAccountAddress: "invalid-address",
          }),
      }),
    });

    await expect(
      runCli(["wallet", "payer", "init", "--mode", "hosted", "--no-prompt"], harness.deps)
    ).rejects.toThrow(
      "Hosted payer setup requires backend wallet access: Backend wallet response returned invalid EVM address at ownerAccountAddress."
    );
  });

  it("uses top-level wallet.address for hosted payer init when ownerAccountAddress fields are absent", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
      fetchResponder: async () => ({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            ok: true,
            wallet: {
              address: "0x00000000000000000000000000000000000000bb",
            },
          }),
      }),
    });

    await runCli(["wallet", "payer", "init", "--mode", "hosted", "--no-prompt"], harness.deps);

    expect(parseLastJsonOutput(harness.outputs)).toMatchObject({
      ok: true,
      payer: {
        mode: "hosted",
        payerAddress: "0x00000000000000000000000000000000000000bb",
      },
    });
  });

  it("rejects hosted payer init when backend wallet payload has invalid wallet.address", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
      fetchResponder: async () => ({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            ok: true,
            wallet: {
              address: "invalid-address",
            },
          }),
      }),
    });

    await expect(
      runCli(["wallet", "payer", "init", "--mode", "hosted", "--no-prompt"], harness.deps)
    ).rejects.toThrow(
      "Hosted payer setup requires backend wallet access: Backend wallet response returned invalid EVM address at wallet.address."
    );
  });

  it("errors when payer status is requested before payer setup", async () => {
    const harness = createHarness();
    await expect(runCli(["wallet", "payer", "status"], harness.deps)).rejects.toThrow(
      "No wallet payer is configured for this agent. Run `cli wallet payer init --mode hosted|local-generate|local-key`."
    );
  });

  it("ignores legacy farcaster-scoped payer config files after wallet cutover", async () => {
    const harness = createHarness();
    harness.files.set(
      "/tmp/cli-tests/.cobuild-cli/agents/default/farcaster/x402-payer.json",
      JSON.stringify(
        {
          version: 1,
          mode: "hosted",
          payerAddress: "0x00000000000000000000000000000000000000aa",
          network: "base",
          token: "usdc",
          createdAt: "2026-03-02T00:00:00.000Z",
        },
        null,
        2
      )
    );

    await expect(runCli(["wallet", "payer", "status"], harness.deps)).rejects.toThrow(
      "No wallet payer is configured for this agent. Run `cli wallet payer init --mode hosted|local-generate|local-key`."
    );
  });

  it("resolves local payer address in status output from stored secret", async () => {
    const harness = createHarness();
    setLocalX402PayerConfig(harness);
    await runCli(["wallet", "payer", "status"], harness.deps);
    expect(parseLastJsonOutput(harness.outputs)).toMatchObject({
      ok: true,
      payer: {
        mode: "local",
        payerAddress: expect.stringMatching(/^0x[0-9a-fA-F]{40}$/),
      },
    });
  });

  it("surfaces hosted payer status wallet fetch failures when payer address is unknown", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
      fetchResponder: async () => ({
        ok: false,
        status: 500,
        text: async () => JSON.stringify({ ok: false, error: "internal error" }),
      }),
    });
    harness.files.set(
      "/tmp/cli-tests/.cobuild-cli/agents/default/wallet/payer.json",
      JSON.stringify(
        {
          version: 1,
          mode: "hosted",
          payerAddress: null,
          network: "base",
          token: "usdc",
          createdAt: "2026-03-02T00:00:00.000Z",
        },
        null,
        2
      )
    );

    await expect(runCli(["wallet", "payer", "status"], harness.deps)).rejects.toThrow(
      "Hosted payer address is unknown and could not be fetched from backend wallet endpoint: Request failed (status 500): internal error"
    );
  });

  it("errors with actionable guidance when post has no payer config in non-interactive mode", async () => {
    const harness = createHarness();
    const signerPath = "/tmp/cli-tests/.cobuild-cli/agents/default/farcaster/ed25519-signer.json";
    harness.files.set(
      signerPath,
      JSON.stringify(
        {
          version: 1,
          algorithm: "ed25519",
          publicKey: `0x${"11".repeat(32)}`,
          privateKeyHex: `0x${"22".repeat(32)}`,
          fid: "123",
        },
        null,
        2
      )
    );

    await expect(runCli(["farcaster", "post", "--text", "Ship update"], harness.deps)).rejects.toThrow(
      "Missing payer config. Run `cli wallet payer init --agent <key> --mode hosted|local-generate|local-key`."
    );
  });

  it("posts in local payer mode without backend x402-payment calls", async () => {
    const idempotencyKey = "8e03978e-40d5-43e8-bc93-6894a57f9324";
    const signerPath = "/tmp/cli-tests/.cobuild-cli/agents/default/farcaster/ed25519-signer.json";
    const harness = createHarness({
      fetchResponder: async (input, init) => {
        const url = String(input);
        if (url.includes("/api/cli/farcaster/x402-payment")) {
          throw new Error("x402 backend signer route should not be called in local mode");
        }
        if (url === "https://hub-api.neynar.com/v1/submitMessage") {
          const xPayment = String((init?.headers as Record<string, string>)["X-PAYMENT"] ?? "");
          expect(xPayment.length).toBeGreaterThan(0);
          const decoded = JSON.parse(Buffer.from(xPayment, "base64").toString("utf8")) as {
            network?: string;
            payload?: { authorization?: { value?: string; from?: string; to?: string } };
          };
          expect(decoded.network).toBe("base");
          expect(decoded.payload?.authorization?.value).toBe("1000");
          expect(decoded.payload?.authorization?.from).toMatch(/^0x[0-9a-fA-F]{40}$/);
          expect(decoded.payload?.authorization?.to).toBe(
            "0xa6a8736f18f383f1cc2d938576933e5ea7df01a1"
          );
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ ok: true }),
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });
    setLocalX402PayerConfig(harness);

    harness.files.set(
      signerPath,
      JSON.stringify(
        {
          version: 2,
          algorithm: "ed25519",
          publicKey: `0x${"11".repeat(32)}`,
          signerRef: {
            source: "file",
            provider: "default",
            id: "/farcaster:ed25519:default:signer",
          },
          fid: 123,
        },
        null,
        2
      )
    );
    harness.files.set(
      "/tmp/cli-tests/.cobuild-cli/secrets.json",
      JSON.stringify(
        {
          "farcaster:ed25519:default:signer": `0x${"22".repeat(32)}`,
          "wallet:payer:default": `0x${"01".repeat(31)}02`,
        },
        null,
        2
      )
    );

    await runCli(
      [
        "farcaster",
        "post",
        "--text",
        "Local mode",
        "--idempotency-key",
        idempotencyKey,
      ],
      harness.deps
    );

    expect(parseLastJsonOutput(harness.outputs)).toMatchObject({
      ok: true,
      replayed: false,
      idempotencyKey,
      result: {
        payerAddress: expect.stringMatching(/^0x[0-9a-fA-F]{40}$/),
        x402Amount: "1000",
        x402Network: "base",
      },
    });
  });

  it("posts casts via x402 and writes local idempotency receipt", async () => {
    const idempotencyKey = "8e03978e-40d5-43e8-bc93-6894a57f9324";
    const signerPath = "/tmp/cli-tests/.cobuild-cli/agents/stored-agent/farcaster/ed25519-signer.json";
    const receiptPath = `/tmp/cli-tests/.cobuild-cli/agents/stored-agent/farcaster/posts/${idempotencyKey}.json`;
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
        agent: "stored-agent",
      },
      fetchResponder: async (input, init) => {
        const url = String(input);
        if (url.endsWith("/api/cli/farcaster/x402-payment")) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                ok: true,
                result: {
                  xPayment: MOCK_PAYMENT_1,
                  agentKey: "stored-agent",
                  payerAddress: "0x0000000000000000000000000000000000000009",
                  token: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
                  amount: "1000",
                  network: "base",
                },
              }),
          };
        }
        if (url === "https://hub-api.neynar.com/v1/submitMessage") {
          expect(init?.headers).toMatchObject({
            "Content-Type": "application/octet-stream",
            "X-PAYMENT": MOCK_PAYMENT_1,
          });
          expect(init?.body).toBeInstanceOf(Uint8Array);
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ ok: true, accepted: true }),
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });
    setHostedX402PayerConfig(harness, "stored-agent");

    harness.files.set(
      signerPath,
      JSON.stringify(
        {
          version: 1,
          algorithm: "ed25519",
          publicKey: `0x${"11".repeat(32)}`,
          privateKeyHex: `0x${"22".repeat(32)}`,
          fid: "123",
        },
        null,
        2
      )
    );

    await runCli(
      [
        "farcaster",
        "post",
        "--text",
        "Ship update",
        "--idempotency-key",
        idempotencyKey,
      ],
      harness.deps
    );

    const output = parseLastJsonOutput(harness.outputs) as {
      ok?: boolean;
      replayed?: boolean;
      idempotencyKey?: string;
      result?: {
        fid?: number;
        text?: string;
        castHashHex?: string;
        hubResponseStatus?: number;
        hubResponse?: unknown;
        payerAddress?: string | null;
        payerAgentKey?: string;
        x402Token?: string | null;
        x402Amount?: string | null;
        x402Network?: string | null;
      };
    };
    expect(output.ok).toBe(true);
    expect(output.replayed).toBe(false);
    expect(output.idempotencyKey).toBe(idempotencyKey);
    expect(output.result?.fid).toBe(123);
    expect(output.result?.text).toBe("Ship update");
    expect(output.result?.castHashHex).toMatch(/^0x[0-9a-f]+$/);
    expect(output.result?.hubResponseStatus).toBe(200);
    expect(output.result?.hubResponse).toEqual({ ok: true, accepted: true });
    expect(output.result?.payerAddress).toBe("0x0000000000000000000000000000000000000009");
    expect(output.result?.payerAgentKey).toBe("stored-agent");
    expect(output.result?.x402Token).toBe("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
    expect(output.result?.x402Amount).toBe("1000");
    expect(output.result?.x402Network).toBe("base");

    const receipt = JSON.parse(harness.files.get(receiptPath) ?? "{}") as {
      state?: string;
      idempotencyKey?: string;
      request?: { fid?: number; text?: string; verify?: boolean };
      messageBytesBase64?: string;
      result?: {
        hubResponseStatus?: number;
        payerAddress?: string | null;
        payerAgentKey?: string;
      };
    };
    expect(receipt.state).toBe("succeeded");
    expect(receipt.idempotencyKey).toBe(idempotencyKey);
    expect(receipt.request).toEqual({ fid: 123, text: "Ship update", verify: false });
    expect(receipt.messageBytesBase64).toBe("");
    expect(receipt.result?.hubResponseStatus).toBe(200);
    expect(receipt.result?.payerAddress).toBe("0x0000000000000000000000000000000000000009");
    expect(receipt.result?.payerAgentKey).toBe("stored-agent");
  });

  it("retries with a fresh x402 payment when the hub returns 402", async () => {
    const idempotencyKey = "8e03978e-40d5-43e8-bc93-6894a57f9324";
    const signerPath = "/tmp/cli-tests/.cobuild-cli/agents/default/farcaster/ed25519-signer.json";
    let x402Calls = 0;
    let hubCalls = 0;
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
      fetchResponder: async (input, init) => {
        const url = String(input);
        if (url.endsWith("/api/cli/farcaster/x402-payment")) {
          x402Calls += 1;
          const xPayment = x402Calls === 1 ? MOCK_PAYMENT_1 : MOCK_PAYMENT_2;
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                ok: true,
                result: {
                  xPayment,
                  agentKey: "default",
                  payerAddress: "0x0000000000000000000000000000000000000007",
                },
              }),
          };
        }
        if (url === "https://hub-api.neynar.com/v1/submitMessage") {
          hubCalls += 1;
          if (hubCalls === 1) {
            expect(init?.headers).toMatchObject({ "X-PAYMENT": MOCK_PAYMENT_1 });
            return { ok: false, status: 402, text: async () => "payment required" };
          }
          expect(init?.headers).toMatchObject({ "X-PAYMENT": MOCK_PAYMENT_2 });
          return { ok: true, status: 200, text: async () => "{\"ok\":true}" };
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });
    setHostedX402PayerConfig(harness);

    harness.files.set(
      signerPath,
      JSON.stringify(
        {
          version: 1,
          algorithm: "ed25519",
          publicKey: `0x${"11".repeat(32)}`,
          privateKeyHex: `0x${"22".repeat(32)}`,
          fid: "123",
        },
        null,
        2
      )
    );

    await runCli(
      [
        "farcaster",
        "post",
        "--text",
        "Ship update",
        "--idempotency-key",
        idempotencyKey,
      ],
      harness.deps
    );

    expect(x402Calls).toBe(2);
    expect(hubCalls).toBe(2);
  });

  it("writes a pending receipt before submit and resumes it on retry", async () => {
    const idempotencyKey = "75d6e51f-4f27-4f17-b32f-4708fdb0f3be";
    const signerPath = "/tmp/cli-tests/.cobuild-cli/agents/default/farcaster/ed25519-signer.json";
    const receiptPath = `/tmp/cli-tests/.cobuild-cli/agents/default/farcaster/posts/${idempotencyKey}.json`;
    let failSubmit = true;
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
      fetchResponder: async (input) => {
        const url = String(input);
        if (url.endsWith("/api/cli/farcaster/x402-payment")) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                ok: true,
                result: {
                  xPayment: MOCK_PAYMENT_RESUME,
                  agentKey: "default",
                },
              }),
          };
        }
        if (url === "https://hub-api.neynar.com/v1/submitMessage") {
          if (failSubmit) {
            return {
              ok: false,
              status: 500,
              text: async () => "temporary failure",
            };
          }
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ ok: true }),
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });
    setHostedX402PayerConfig(harness);

    harness.files.set(
      signerPath,
      JSON.stringify(
        {
          version: 1,
          algorithm: "ed25519",
          publicKey: `0x${"11".repeat(32)}`,
          privateKeyHex: `0x${"22".repeat(32)}`,
          fid: "123",
        },
        null,
        2
      )
    );

    await expect(
      runCli(
        [
          "farcaster",
          "post",
          "--text",
          "Ship update",
          "--idempotency-key",
          idempotencyKey,
        ],
        harness.deps
      )
    ).rejects.toThrow(
      new RegExp(
        `Neynar hub rejected Farcaster cast submit \\(status 500, cast 0x[0-9a-f]+\\): temporary failure \\(idempotency key: ${idempotencyKey}\\)`
      )
    );

    const pendingReceipt = JSON.parse(harness.files.get(receiptPath) ?? "{}") as {
      state?: string;
      castHashHex?: string;
      messageBytesBase64?: string;
      result?: unknown;
    };
    expect(pendingReceipt.state).toBe("pending");
    expect(pendingReceipt.castHashHex).toMatch(/^0x[0-9a-f]+$/);
    expect(pendingReceipt.messageBytesBase64).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(pendingReceipt.result).toBeUndefined();

    failSubmit = false;

    await runCli(
      [
        "farcaster",
        "post",
        "--text",
        "Ship update",
        "--idempotency-key",
        idempotencyKey,
      ],
      harness.deps
    );

    const output = parseLastJsonOutput(harness.outputs) as {
      replayed?: boolean;
      resumedPending?: boolean;
      result?: { castHashHex?: string; hubResponseStatus?: number };
    };
    expect(output.replayed).toBe(false);
    expect(output.resumedPending).toBe(true);
    expect(output.result?.hubResponseStatus).toBe(200);
    expect(output.result?.castHashHex).toBe(pendingReceipt.castHashHex);

    const succeededReceipt = JSON.parse(harness.files.get(receiptPath) ?? "{}") as {
      state?: string;
      castHashHex?: string;
      result?: { hubResponseStatus?: number };
    };
    expect(succeededReceipt.state).toBe("succeeded");
    expect(succeededReceipt.castHashHex).toBe(pendingReceipt.castHashHex);
    expect(succeededReceipt.result?.hubResponseStatus).toBe(200);
  });

  it("verifies cast inclusion with --verify=once and returns verification metadata", async () => {
    const idempotencyKey = "d66ff1d5-c1f0-44f7-89a8-cf0264f45f6e";
    const signerPath = "/tmp/cli-tests/.cobuild-cli/agents/default/farcaster/ed25519-signer.json";
    let verifyCalls = 0;
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
      fetchResponder: async (input) => {
        const url = String(input);
        if (url.endsWith("/api/cli/farcaster/x402-payment")) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                ok: true,
                result: {
                  xPayment: MOCK_PAYMENT_VERIFY,
                  agentKey: "default",
                },
              }),
          };
        }
        if (url === "https://hub-api.neynar.com/v1/submitMessage") {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ ok: true }),
          };
        }
        if (url.startsWith("https://hub-api.neynar.com/v1/castById")) {
          verifyCalls += 1;
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ ok: true }),
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });
    setHostedX402PayerConfig(harness);

    harness.files.set(
      signerPath,
      JSON.stringify(
        {
          version: 1,
          algorithm: "ed25519",
          publicKey: `0x${"11".repeat(32)}`,
          privateKeyHex: `0x${"22".repeat(32)}`,
          fid: "123",
        },
        null,
        2
      )
    );

    await runCli(
      [
        "farcaster",
        "post",
        "--text",
        "Ship update",
        "--idempotency-key",
        idempotencyKey,
        "--verify=once",
      ],
      harness.deps
    );

    const output = parseLastJsonOutput(harness.outputs) as {
      result?: {
        verification?: { enabled?: boolean; included?: boolean; attempts?: number };
      };
    };
    expect(verifyCalls).toBe(1);
    expect(output.result?.verification).toEqual({
      enabled: true,
      included: true,
      attempts: 1,
    });
    expect(
      harness.errors.some((line) =>
        line.includes("Verification reads hit Neynar hub paywall (HTTP 402);")
      )
    ).toBe(false);
  });

  it("retries verification reads in poll mode until inclusion is observed", async () => {
    const signerPath = "/tmp/cli-tests/.cobuild-cli/agents/default/farcaster/ed25519-signer.json";
    let verifyCalls = 0;
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
      fetchResponder: async (input) => {
        const url = String(input);
        if (url.endsWith("/api/cli/farcaster/x402-payment")) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                ok: true,
                result: {
                  xPayment: MOCK_PAYMENT_POLL,
                  agentKey: "default",
                },
              }),
          };
        }
        if (url === "https://hub-api.neynar.com/v1/submitMessage") {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ ok: true }),
          };
        }
        if (url.startsWith("https://hub-api.neynar.com/v1/castById")) {
          verifyCalls += 1;
          if (verifyCalls === 1) {
            return { ok: false, status: 404, text: async () => "missing" };
          }
          return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true }) };
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });
    setHostedX402PayerConfig(harness);
    harness.files.set(
      signerPath,
      JSON.stringify(
        {
          version: 1,
          algorithm: "ed25519",
          publicKey: `0x${"11".repeat(32)}`,
          privateKeyHex: `0x${"22".repeat(32)}`,
          fid: "123",
        },
        null,
        2
      )
    );

    await runCli(["farcaster", "post", "--text", "Ship update", "--verify=poll"], harness.deps);
    expect(parseLastJsonOutput(harness.outputs)).toMatchObject({
      result: {
        verification: {
          attempts: 2,
        },
      },
    });
    expect(verifyCalls).toBe(2);
    expect(
      harness.errors.some((line) =>
        line.includes("Verification polling may incur up to 5 additional paid hub calls (0.001 USDC each).")
      )
    ).toBe(true);
  });

  it("fails poll verification after max 404 checks", async () => {
    const signerPath = "/tmp/cli-tests/.cobuild-cli/agents/default/farcaster/ed25519-signer.json";
    let verifyCalls = 0;
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
      fetchResponder: async (input) => {
        const url = String(input);
        if (url.endsWith("/api/cli/farcaster/x402-payment")) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                ok: true,
                result: {
                  xPayment: MOCK_PAYMENT_POLL_FAIL,
                  agentKey: "default",
                },
              }),
          };
        }
        if (url === "https://hub-api.neynar.com/v1/submitMessage") {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ ok: true }),
          };
        }
        if (url.startsWith("https://hub-api.neynar.com/v1/castById")) {
          verifyCalls += 1;
          return { ok: false, status: 404, text: async () => "missing" };
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });
    setHostedX402PayerConfig(harness);
    harness.files.set(
      signerPath,
      JSON.stringify(
        {
          version: 1,
          algorithm: "ed25519",
          publicKey: `0x${"11".repeat(32)}`,
          privateKeyHex: `0x${"22".repeat(32)}`,
          fid: "123",
        },
        null,
        2
      )
    );

    await expect(
      runCli(["farcaster", "post", "--text", "Ship update", "--verify=poll"], harness.deps)
    ).rejects.toThrow(
      "Cast was not observed in Neynar hub read after 5 verification checks (idempotency key: 8e03978e-40d5-43e8-bc93-6894a57f9324)"
    );
    expect(verifyCalls).toBe(5);
  }, 12_000);

  it("skips cast verification reads when verify mode is none", async () => {
    const signerPath = "/tmp/cli-tests/.cobuild-cli/agents/default/farcaster/ed25519-signer.json";
    let verifyCalls = 0;
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
      fetchResponder: async (input) => {
        const url = String(input);
        if (url.endsWith("/api/cli/farcaster/x402-payment")) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                ok: true,
                result: {
                  xPayment: MOCK_PAYMENT_NONE,
                  agentKey: "default",
                },
              }),
          };
        }
        if (url === "https://hub-api.neynar.com/v1/submitMessage") {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ ok: true }),
          };
        }
        if (url.startsWith("https://hub-api.neynar.com/v1/castById")) {
          verifyCalls += 1;
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ ok: true }),
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });
    setHostedX402PayerConfig(harness);

    harness.files.set(
      signerPath,
      JSON.stringify(
        {
          version: 1,
          algorithm: "ed25519",
          publicKey: `0x${"11".repeat(32)}`,
          privateKeyHex: `0x${"22".repeat(32)}`,
          fid: "123",
        },
        null,
        2
      )
    );

    await runCli(["farcaster", "post", "--text", "Ship update", "--verify=none"], harness.deps);
    expect(verifyCalls).toBe(0);
  });

  it("rejects invalid verify mode values", async () => {
    const harness = createHarness();
    await expect(runCli(["farcaster", "post", "--text", "Ship update", "--verify=maybe"], harness.deps)).rejects.toThrow(
      'Invalid option: expected one of "none"|"once"|"poll"'
    );
  });

  it("uses local x402 payment generation for verification reads after 402", async () => {
    const signerPath = "/tmp/cli-tests/.cobuild-cli/agents/default/farcaster/ed25519-signer.json";
    let castByIdCalls = 0;
    const harness = createHarness({
      fetchResponder: async (input, init) => {
        const url = String(input);
        if (url.includes("/api/cli/farcaster/x402-payment")) {
          throw new Error("backend x402-payment route should not be used in local mode verification");
        }
        if (url === "https://hub-api.neynar.com/v1/submitMessage") {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ ok: true }),
          };
        }
        if (url.startsWith("https://hub-api.neynar.com/v1/castById")) {
          castByIdCalls += 1;
          if (castByIdCalls === 1) {
            return {
              ok: false,
              status: 402,
              text: async () => "payment required",
            };
          }
          expect((init?.headers as Record<string, string>)["X-PAYMENT"]).toBeTruthy();
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ ok: true }),
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });
    setLocalX402PayerConfig(harness);
    harness.files.set(
      signerPath,
      JSON.stringify(
        {
          version: 2,
          algorithm: "ed25519",
          publicKey: `0x${"11".repeat(32)}`,
          signerRef: {
            source: "file",
            provider: "default",
            id: "/farcaster:ed25519:default:signer",
          },
          fid: 123,
        },
        null,
        2
      )
    );
    harness.files.set(
      "/tmp/cli-tests/.cobuild-cli/secrets.json",
      JSON.stringify(
        {
          "farcaster:ed25519:default:signer": `0x${"22".repeat(32)}`,
          "wallet:payer:default": `0x${"01".repeat(31)}02`,
        },
        null,
        2
      )
    );

    await runCli(["farcaster", "post", "--text", "Ship update", "--verify=once"], harness.deps);
    expect(castByIdCalls).toBe(2);
    expect(
      harness.errors.some((line) =>
        line.includes(
          "Verification reads hit Neynar hub paywall (HTTP 402); verification calls may cost 0.001 USDC each."
        )
      )
    ).toBe(true);
  });

  it("replays successful post response when the same idempotency key is reused", async () => {
    const idempotencyKey = "8e03978e-40d5-43e8-bc93-6894a57f9324";
    const signerPath = "/tmp/cli-tests/.cobuild-cli/agents/default/farcaster/ed25519-signer.json";
    const receiptPath = `/tmp/cli-tests/.cobuild-cli/agents/default/farcaster/posts/${idempotencyKey}.json`;
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
    });

    harness.files.set(
      signerPath,
      JSON.stringify(
        {
          version: 1,
          algorithm: "ed25519",
          publicKey: `0x${"11".repeat(32)}`,
          privateKeyHex: `0x${"22".repeat(32)}`,
          fid: "123",
        },
        null,
        2
      )
    );
    harness.files.set(
      receiptPath,
      JSON.stringify(
        {
          version: 1,
          idempotencyKey,
          request: { fid: 123, text: "Ship update" },
          result: {
            castHashHex: "0xabc123",
            hubResponseStatus: 200,
            hubResponseText: "{\"ok\":true}",
            payerAddress: "0x0000000000000000000000000000000000000009",
            payerAgentKey: "default",
            x402Token: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
            x402Amount: "1000",
            x402Network: "base",
          },
          savedAt: "2026-03-02T00:00:00.000Z",
        },
        null,
        2
      )
    );

    await runCli(
      [
        "farcaster",
        "post",
        "--text",
        "Ship update",
        "--idempotency-key",
        idempotencyKey,
      ],
      harness.deps
    );

    expect(harness.fetchMock).not.toHaveBeenCalled();
    expect(parseLastJsonOutput(harness.outputs)).toEqual({
      ok: true,
      replayed: true,
      idempotencyKey,
      result: {
        fid: 123,
        text: "Ship update",
        castHashHex: "0xabc123",
        hubResponseStatus: 200,
        hubResponse: { ok: true },
        payerAddress: "0x0000000000000000000000000000000000000009",
        payerAgentKey: "default",
        x402Token: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
        x402Amount: "1000",
        x402Network: "base",
      },
    });
  });

  it("rejects idempotency replay when --verify differs from stored request", async () => {
    const idempotencyKey = "8e03978e-40d5-43e8-bc93-6894a57f9324";
    const signerPath = "/tmp/cli-tests/.cobuild-cli/agents/default/farcaster/ed25519-signer.json";
    const receiptPath = `/tmp/cli-tests/.cobuild-cli/agents/default/farcaster/posts/${idempotencyKey}.json`;
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
    });
    setHostedX402PayerConfig(harness);

    harness.files.set(
      signerPath,
      JSON.stringify(
        {
          version: 1,
          algorithm: "ed25519",
          publicKey: `0x${"11".repeat(32)}`,
          privateKeyHex: `0x${"22".repeat(32)}`,
          fid: "123",
        },
        null,
        2
      )
    );
    harness.files.set(
      receiptPath,
      JSON.stringify(
        {
          version: 1,
          idempotencyKey,
          state: "succeeded",
          request: { fid: 123, text: "Ship update", verify: false },
          castHashHex: "0xabc123",
          messageBytesBase64: "AQID",
          result: {
            hubResponseStatus: 200,
            hubResponseText: "{\"ok\":true}",
          },
          savedAt: "2026-03-02T00:00:00.000Z",
        },
        null,
        2
      )
    );

    await expect(
      runCli(
        [
          "farcaster",
          "post",
          "--text",
          "Ship update",
          "--idempotency-key",
          idempotencyKey,
          "--verify",
        ],
        harness.deps
      )
    ).rejects.toThrow("Idempotency key was already used for a different Farcaster post request.");
  });

  it("rejects idempotency replay when verify mode changes from once to poll", async () => {
    const idempotencyKey = "8e03978e-40d5-43e8-bc93-6894a57f9324";
    const signerPath = "/tmp/cli-tests/.cobuild-cli/agents/default/farcaster/ed25519-signer.json";
    const receiptPath = `/tmp/cli-tests/.cobuild-cli/agents/default/farcaster/posts/${idempotencyKey}.json`;
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
    });
    setHostedX402PayerConfig(harness);

    harness.files.set(
      signerPath,
      JSON.stringify(
        {
          version: 1,
          algorithm: "ed25519",
          publicKey: `0x${"11".repeat(32)}`,
          privateKeyHex: `0x${"22".repeat(32)}`,
          fid: "123",
        },
        null,
        2
      )
    );
    harness.files.set(
      receiptPath,
      JSON.stringify(
        {
          version: 1,
          idempotencyKey,
          state: "succeeded",
          request: { fid: 123, text: "Ship update", verify: true, verifyMode: "once" },
          castHashHex: "0xabc123",
          messageBytesBase64: "",
          result: {
            hubResponseStatus: 200,
            hubResponseText: "{\"ok\":true}",
          },
          savedAt: "2026-03-02T00:00:00.000Z",
        },
        null,
        2
      )
    );

    await expect(
      runCli(
        [
          "farcaster",
          "post",
          "--text",
          "Ship update",
          "--idempotency-key",
          idempotencyKey,
          "--verify=poll",
        ],
        harness.deps
      )
    ).rejects.toThrow("Idempotency key was already used for a different Farcaster post request.");
  });

  it("requires fid in signer metadata or via --fid for post", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
    });
    const signerPath = "/tmp/cli-tests/.cobuild-cli/agents/default/farcaster/ed25519-signer.json";
    harness.files.set(
      signerPath,
      JSON.stringify(
        {
          version: 1,
          algorithm: "ed25519",
          publicKey: `0x${"11".repeat(32)}`,
          privateKeyHex: `0x${"22".repeat(32)}`,
        },
        null,
        2
      )
    );

    await expect(runCli(["farcaster", "post", "--text", "Ship update"], harness.deps)).rejects.toThrow(
      "Farcaster FID missing. Pass --fid or run `cli farcaster signup` to refresh signer metadata."
    );
  });

  it("validates post text and fid options", async () => {
    const harness = createHarness();
    const signerPath = "/tmp/cli-tests/.cobuild-cli/agents/default/farcaster/ed25519-signer.json";
    harness.files.set(
      signerPath,
      JSON.stringify(
        {
          version: 1,
          algorithm: "ed25519",
          publicKey: `0x${"11".repeat(32)}`,
          privateKeyHex: `0x${"22".repeat(32)}`,
          fid: "123",
        },
        null,
        2
      )
    );

    await expect(runCli(["farcaster", "post"], harness.deps)).rejects.toThrow("Usage:");
    await expect(runCli(["farcaster", "post", "--text", "   "], harness.deps)).rejects.toThrow(
      "--text cannot be empty"
    );
    await expect(runCli(["farcaster", "post", "--text", "ok", "--fid", "abc"], harness.deps)).rejects.toThrow(
      "Invalid input: expected number, received NaN"
    );
    await expect(
      runCli(["farcaster", "post", "--text", "ok", "--reply-to", "not-a-reply-target"], harness.deps)
    ).rejects.toThrow("--reply-to must be in the format <parent-fid:0x-parent-hash>");
    await expect(
      runCli(["farcaster", "post", "--text", "ok", "--reply-to", "123:0xdeadbeef"], harness.deps)
    ).rejects.toThrow("--reply-to parent hash must be 0x + 40 hex chars");

    const tooLong = "a".repeat(321);
    await expect(runCli(["farcaster", "post", "--text", tooLong], harness.deps)).rejects.toThrow(
      "--text must be at most 320 bytes"
    );
  });

  it("rejects --fid values larger than Number.MAX_SAFE_INTEGER", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
    });
    const signerPath = "/tmp/cli-tests/.cobuild-cli/agents/default/farcaster/ed25519-signer.json";
    harness.files.set(
      signerPath,
      JSON.stringify(
        {
          version: 1,
          algorithm: "ed25519",
          publicKey: `0x${"11".repeat(32)}`,
          privateKeyHex: `0x${"22".repeat(32)}`,
          fid: "123",
        },
        null,
        2
      )
    );

    await expect(
      runCli(["farcaster", "post", "--text", "ok", "--fid", "9007199254740992"], harness.deps)
    ).rejects.toThrow("Too big: expected int to be <=9007199254740991");
  });

  it("supports --fid override and --signer-file for post", async () => {
    const signerPath = "/tmp/cli-tests/custom-signer.json";
    const idempotencyKey = "75d6e51f-4f27-4f17-b32f-4708fdb0f3be";
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
      fetchResponder: async (input, init) => {
        const url = String(input);
        if (url.endsWith("/api/cli/farcaster/x402-payment")) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                ok: true,
                result: {
                  xPayment: MOCK_PAYMENT_OVERRIDE,
                  agentKey: "default",
                },
              }),
          };
        }
        if (url === "https://hub-api.neynar.com/v1/submitMessage") {
          expect(init?.headers).toMatchObject({ "X-PAYMENT": MOCK_PAYMENT_OVERRIDE });
          return { ok: true, status: 200, text: async () => "accepted" };
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });
    setHostedX402PayerConfig(harness);

    harness.files.set(
      signerPath,
      JSON.stringify(
        {
          version: 1,
          algorithm: "ed25519",
          publicKey: `0x${"11".repeat(32)}`,
          privateKeyHex: `0x${"22".repeat(32)}`,
        },
        null,
        2
      )
    );

    await runCli(
      [
        "farcaster",
        "post",
        "--text",
        "Ship update",
        "--fid",
        "456",
        "--signer-file",
        signerPath,
        "--idempotency-key",
        idempotencyKey,
      ],
      harness.deps
    );

    const output = parseLastJsonOutput(harness.outputs) as {
      result?: { fid?: number; hubResponse?: unknown };
    };
    expect(output.result?.fid).toBe(456);
    expect(output.result?.hubResponse).toBe("accepted");
  });

  it("supports reply posts through --reply-to and encodes parentCastId", async () => {
    const signerPath = "/tmp/cli-tests/custom-reply-signer.json";
    const idempotencyKey = "13bf2cd4-1e2e-4ec9-b97d-5fc816a993be";
    const parentHashHex = `0x${"a".repeat(40)}`;
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
      fetchResponder: async (input, init) => {
        const url = String(input);
        if (url.endsWith("/api/cli/farcaster/x402-payment")) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                ok: true,
                result: {
                  xPayment: MOCK_PAYMENT_REPLY,
                  agentKey: "default",
                },
              }),
          };
        }
        if (url === "https://hub-api.neynar.com/v1/submitMessage") {
          const body = init?.body;
          const bytes = body instanceof Uint8Array ? body : new Uint8Array(Buffer.from(String(body ?? ""), "utf8"));
          const message = Message.decode(bytes);
          expect(message.data?.castAddBody?.parentCastId?.fid).toBe(789);
          expect(Buffer.from(message.data?.castAddBody?.parentCastId?.hash ?? []).toString("hex")).toBe(
            "a".repeat(40)
          );
          return { ok: true, status: 200, text: async () => "accepted" };
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });
    setHostedX402PayerConfig(harness);

    harness.files.set(
      signerPath,
      JSON.stringify(
        {
          version: 1,
          algorithm: "ed25519",
          publicKey: `0x${"11".repeat(32)}`,
          privateKeyHex: `0x${"22".repeat(32)}`,
        },
        null,
        2
      )
    );

    await runCli(
      [
        "farcaster",
        "post",
        "--text",
        "Replying on thread",
        "--fid",
        "456",
        "--reply-to",
        `789:${parentHashHex}`,
        "--signer-file",
        signerPath,
        "--idempotency-key",
        idempotencyKey,
      ],
      harness.deps
    );

    const output = parseLastJsonOutput(harness.outputs) as {
      result?: {
        parentAuthorFid?: number;
        parentHashHex?: string;
      };
    };
    expect(output.result?.parentAuthorFid).toBe(789);
    expect(output.result?.parentHashHex).toBe(parentHashHex);
  });

  it("migrates legacy plaintext signer file to signerRef storage during post", async () => {
    const signerPath = "/tmp/cli-tests/.cobuild-cli/agents/default/farcaster/ed25519-signer.json";
    const secretsPath = "/tmp/cli-tests/.cobuild-cli/secrets.json";
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
      fetchResponder: async (input) => {
        const url = String(input);
        if (url.endsWith("/api/cli/farcaster/x402-payment")) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                ok: true,
                result: {
                  xPayment: MOCK_PAYMENT_MIGRATE,
                  agentKey: "default",
                },
              }),
          };
        }
        if (url === "https://hub-api.neynar.com/v1/submitMessage") {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ ok: true }),
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });
    setHostedX402PayerConfig(harness);

    harness.files.set(
      signerPath,
      JSON.stringify(
        {
          version: 1,
          algorithm: "ed25519",
          publicKey: `0x${"11".repeat(32)}`,
          privateKeyHex: `0x${"22".repeat(32)}`,
          fid: "123",
        },
        null,
        2
      )
    );

    await runCli(
      [
        "farcaster",
        "post",
        "--text",
        "Ship update",
        "--idempotency-key",
        "75d6e51f-4f27-4f17-b32f-4708fdb0f3be",
      ],
      harness.deps
    );

    const migratedSigner = JSON.parse(harness.files.get(signerPath) ?? "{}") as Record<string, unknown>;
    expect(migratedSigner.publicKey).toBe(`0x${"11".repeat(32)}`);
    expect(migratedSigner.signerRef).toEqual({
      source: "file",
      provider: "default",
      id: "/farcaster:ed25519:default:signer",
    });
    expect(migratedSigner.privateKeyHex).toBeUndefined();
    expect(JSON.parse(harness.files.get(secretsPath) ?? "{}")).toMatchObject({
      "farcaster:ed25519:default:signer": `0x${"22".repeat(32)}`,
    });
  });

  it("fails when authenticated token agent does not match configured agent", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
        agent: "local-agent",
      },
      fetchResponder: async (input) => {
        const url = String(input);
        if (url.endsWith("/api/cli/farcaster/x402-payment")) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                ok: true,
                result: {
                  xPayment: MOCK_PAYMENT_1,
                  agentKey: "token-agent",
                },
              }),
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });
    setHostedX402PayerConfig(harness, "local-agent");
    const signerPath = "/tmp/cli-tests/.cobuild-cli/agents/local-agent/farcaster/ed25519-signer.json";
    harness.files.set(
      signerPath,
      JSON.stringify(
        {
          version: 1,
          algorithm: "ed25519",
          publicKey: `0x${"11".repeat(32)}`,
          privateKeyHex: `0x${"22".repeat(32)}`,
          fid: "123",
        },
        null,
        2
      )
    );

    await expect(
      runCli(
        [
          "farcaster",
          "post",
          "--text",
          "Ship update",
          "--idempotency-key",
          "75d6e51f-4f27-4f17-b32f-4708fdb0f3be",
        ],
        harness.deps
      )
    ).rejects.toThrow(
      "Configured agent (local-agent) does not match authenticated token agent (token-agent). Update CLI config or use a token for the same agent."
    );
  });

  it("fails when signer file is missing or malformed", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
    });
    setHostedX402PayerConfig(harness);
    const signerPath = "/tmp/cli-tests/.cobuild-cli/agents/default/farcaster/ed25519-signer.json";

    await expect(runCli(["farcaster", "post", "--text", "Ship update"], harness.deps)).rejects.toThrow(
      "Could not read Farcaster signer file. Run `cli farcaster signup` or pass --signer-file."
    );

    harness.files.set(signerPath, "{");
    await expect(runCli(["farcaster", "post", "--text", "Ship update"], harness.deps)).rejects.toThrow(
      "Farcaster signer file contains invalid JSON."
    );

    harness.files.set(signerPath, JSON.stringify({ privateKeyHex: `0x${"22".repeat(32)}` }, null, 2));
    await expect(runCli(["farcaster", "post", "--text", "Ship update"], harness.deps)).rejects.toThrow(
      "Farcaster signer file is missing a valid publicKey."
    );
  });

  it("rejects signerRef entries with invalid or missing private-key material", async () => {
    const signerPath = "/tmp/cli-tests/.cobuild-cli/agents/default/farcaster/ed25519-signer.json";
    const secretsPath = "/tmp/cli-tests/.cobuild-cli/secrets.json";
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
    });
    setHostedX402PayerConfig(harness);

    harness.files.set(
      signerPath,
      JSON.stringify(
        {
          version: 2,
          algorithm: "ed25519",
          publicKey: `0x${"11".repeat(32)}`,
          signerRef: {
            source: "file",
            provider: "default",
            id: "/farcaster:ed25519:default:signer",
          },
          fid: 123,
        },
        null,
        2
      )
    );
    harness.files.set(
      secretsPath,
      JSON.stringify(
        {
          "farcaster:ed25519:default:signer": "not-a-private-key",
        },
        null,
        2
      )
    );

    await expect(
      runCli(["farcaster", "post", "--text", "Ship update", "--fid", "123"], harness.deps)
    ).rejects.toThrow("Farcaster signer secret ref did not resolve to a valid private key.");

    harness.files.set(
      signerPath,
      JSON.stringify(
        {
          version: 2,
          algorithm: "ed25519",
          publicKey: `0x${"11".repeat(32)}`,
          fid: 123,
        },
        null,
        2
      )
    );

    await expect(
      runCli(["farcaster", "post", "--text", "Ship update", "--fid", "123"], harness.deps)
    ).rejects.toThrow("Farcaster signer file is missing a valid signerRef/privateKeyHex.");
  });

  it("rejects invalid or conflicting idempotency receipts", async () => {
    const idempotencyKey = "8e03978e-40d5-43e8-bc93-6894a57f9324";
    const signerPath = "/tmp/cli-tests/.cobuild-cli/agents/default/farcaster/ed25519-signer.json";
    const receiptPath = `/tmp/cli-tests/.cobuild-cli/agents/default/farcaster/posts/${idempotencyKey}.json`;
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
    });
    setHostedX402PayerConfig(harness);

    harness.files.set(
      signerPath,
      JSON.stringify(
        {
          version: 1,
          algorithm: "ed25519",
          publicKey: `0x${"11".repeat(32)}`,
          privateKeyHex: `0x${"22".repeat(32)}`,
          fid: "123",
        },
        null,
        2
      )
    );

    harness.files.set(receiptPath, JSON.stringify({ version: 1 }, null, 2));
    await expect(
      runCli(
        [
          "farcaster",
          "post",
          "--text",
          "Ship update",
          "--idempotency-key",
          idempotencyKey,
        ],
        harness.deps
      )
    ).rejects.toThrow(
      "Farcaster post idempotency receipt is invalid. Delete the receipt and retry with a new idempotency key."
    );

    harness.files.set(
      receiptPath,
      JSON.stringify(
        {
          version: 1,
          idempotencyKey,
          request: { fid: 123, text: "Different text" },
          result: { castHashHex: "0xabc", hubResponseStatus: 200, hubResponseText: "{}" },
          savedAt: "2026-03-02T00:00:00.000Z",
        },
        null,
        2
      )
    );
    await expect(
      runCli(
        [
          "farcaster",
          "post",
          "--text",
          "Ship update",
          "--idempotency-key",
          idempotencyKey,
        ],
        harness.deps
      )
    ).rejects.toThrow("Idempotency key was already used for a different Farcaster post request.");
  });

  it("surfaces receipt read failures for idempotent post replays", async () => {
    const idempotencyKey = "8e03978e-40d5-43e8-bc93-6894a57f9324";
    const signerPath = "/tmp/cli-tests/.cobuild-cli/agents/default/farcaster/ed25519-signer.json";
    const receiptPath = `/tmp/cli-tests/.cobuild-cli/agents/default/farcaster/posts/${idempotencyKey}.json`;
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
    });
    setHostedX402PayerConfig(harness);
    harness.files.set(
      signerPath,
      JSON.stringify(
        {
          version: 1,
          algorithm: "ed25519",
          publicKey: `0x${"11".repeat(32)}`,
          privateKeyHex: `0x${"22".repeat(32)}`,
          fid: "123",
        },
        null,
        2
      )
    );
    harness.files.set(receiptPath, JSON.stringify({ version: 1 }, null, 2));

    const originalRead = harness.deps.fs.readFileSync;
    harness.deps.fs.readFileSync = (file, encoding) => {
      if (file === receiptPath) {
        throw new Error("EACCES");
      }
      return originalRead(file, encoding);
    };

    await expect(
      runCli(
        [
          "farcaster",
          "post",
          "--text",
          "Ship update",
          "--idempotency-key",
          idempotencyKey,
        ],
        harness.deps
      )
    ).rejects.toThrow("Failed to read Farcaster post idempotency receipt.");
  });

  it("surfaces hub and x402 response validation errors with idempotency context", async () => {
    const idempotencyKey = "8e03978e-40d5-43e8-bc93-6894a57f9324";
    const signerPath = "/tmp/cli-tests/.cobuild-cli/agents/default/farcaster/ed25519-signer.json";
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
      fetchResponder: async (input) => {
        const url = String(input);
        if (url.endsWith("/api/cli/farcaster/x402-payment")) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ ok: true, result: {} }),
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });
    setHostedX402PayerConfig(harness);

    harness.files.set(
      signerPath,
      JSON.stringify(
        {
          version: 1,
          algorithm: "ed25519",
          publicKey: `0x${"11".repeat(32)}`,
          privateKeyHex: `0x${"22".repeat(32)}`,
          fid: "123",
        },
        null,
        2
      )
    );

    await expect(
      runCli(
        [
          "farcaster",
          "post",
          "--text",
          "Ship update",
          "--idempotency-key",
          idempotencyKey,
        ],
        harness.deps
      )
    ).rejects.toThrow(
      `Build-bot x402 payment response did not include xPayment. (idempotency key: ${idempotencyKey})`
    );

    harness.fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/api/cli/farcaster/x402-payment")) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ ok: true, result: { xPayment: MOCK_PAYMENT_1 } }),
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    await expect(
      runCli(
        [
          "farcaster",
          "post",
          "--text",
          "Ship update",
          "--idempotency-key",
          idempotencyKey,
        ],
        harness.deps
      )
    ).rejects.toThrow(
      `Build-bot x402 payment response did not include agentKey. (idempotency key: ${idempotencyKey})`
    );

    harness.fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/api/cli/farcaster/x402-payment")) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({ ok: true, result: { xPayment: MOCK_PAYMENT_1, agentKey: "default" } }),
        };
      }
      if (url === "https://hub-api.neynar.com/v1/submitMessage") {
        return {
          ok: false,
          status: 500,
          text: async () => "\u0000hub\tfailed\n" + "x".repeat(400),
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    await expect(
      runCli(
        [
          "farcaster",
          "post",
          "--text",
          "Ship update",
          "--idempotency-key",
          "75d6e51f-4f27-4f17-b32f-4708fdb0f3be",
        ],
        harness.deps
      )
    ).rejects.toThrow(
      /Neynar hub rejected Farcaster cast submit \(status 500, cast 0x[0-9a-f]+\): hub failed/
    );
  });

  it("rejects invalid hosted x402 payment payloads before hub submit", async () => {
    const signerPath = "/tmp/cli-tests/.cobuild-cli/agents/default/farcaster/ed25519-signer.json";
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
    });
    setHostedX402PayerConfig(harness);

    harness.files.set(
      signerPath,
      JSON.stringify(
        {
          version: 1,
          algorithm: "ed25519",
          publicKey: `0x${"11".repeat(32)}`,
          privateKeyHex: `0x${"22".repeat(32)}`,
          fid: "123",
        },
        null,
        2
      )
    );

    const invalidCases: Array<{ key: string; xPayment: string; expected: string }> = [
      {
        key: "11111111-1111-4111-8111-111111111111",
        xPayment: "not-base64-json",
        expected: "x402 payment header from hosted source is not valid base64 JSON.",
      },
      {
        key: "12121212-1212-4121-8121-121212121212",
        xPayment: Buffer.from(JSON.stringify("not-an-object")).toString("base64"),
        expected: "x402 payment header from hosted source is not a JSON object.",
      },
      {
        key: "22222222-2222-4222-8222-222222222222",
        xPayment: mockXPayment("network-mismatch", { network: "optimism" }),
        expected: 'x402 payment header network mismatch: expected "base", got "optimism".',
      },
      {
        key: "33333333-3333-4333-8333-333333333333",
        xPayment: mockXPayment("missing-auth", { includeAuthorization: false }),
        expected: "x402 payment header from hosted source is missing payload.authorization.",
      },
      {
        key: "34343434-3434-4343-8343-343434343434",
        xPayment: mutateXPayment(mockXPayment("missing-to"), (payload) => {
          const inner = payload.payload as Record<string, unknown>;
          const auth = inner.authorization as Record<string, unknown>;
          delete auth.to;
        }),
        expected: "x402 payment header from hosted source is missing payload.authorization.to.",
      },
      {
        key: "44444444-4444-4444-8444-444444444444",
        xPayment: mockXPayment("to-mismatch", { to: "0x000000000000000000000000000000000000dEaD" }),
        expected:
          "x402 payment \"to\" address mismatch: expected 0xa6a8736f18f383f1cc2d938576933e5ea7df01a1, got 0x000000000000000000000000000000000000dead. Refusing to send payment to unknown address.",
      },
      {
        key: "55555555-5555-4555-8555-555555555555",
        xPayment: mockXPayment("value-mismatch", { value: "999" }),
        expected:
          "x402 payment value mismatch: expected 1000, got 999. Refusing to send unexpected payment amount.",
      },
      {
        key: "66666666-6666-4666-8666-666666666666",
        xPayment: mutateXPayment(mockXPayment("invalid-valid-before-type"), (payload) => {
          const inner = payload.payload as Record<string, unknown>;
          const auth = inner.authorization as Record<string, unknown>;
          auth.validBefore = { unexpected: true };
        }),
        expected: "x402 payment header from hosted source is missing payload.authorization.validBefore.",
      },
      {
        key: "67676767-6767-4676-8676-676767676767",
        xPayment: mockXPayment("non-finite-valid-before", { validBefore: "not-a-number" }),
        expected:
          "x402 payment header from hosted source has invalid payload.authorization.validBefore (not-a-number).",
      },
      {
        key: "77777777-7777-4777-8777-777777777777",
        xPayment: mockXPayment("expired", { validBefore: "1" }),
        expected: "x402 payment header from hosted source has expired (validBefore=1).",
      },
    ];

    for (const invalidCase of invalidCases) {
      harness.fetchMock.mockClear();
      harness.fetchMock.mockImplementation(async (input) => {
        const url = String(input);
        if (url.endsWith("/api/cli/farcaster/x402-payment")) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                ok: true,
                result: { xPayment: invalidCase.xPayment, agentKey: "default" },
              }),
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      });

      await expect(
        runCli(
          [
            "farcaster",
            "post",
            "--text",
            "Ship update",
            "--idempotency-key",
            invalidCase.key,
          ],
          harness.deps
        )
      ).rejects.toThrow(`${invalidCase.expected} (idempotency key: ${invalidCase.key})`);

      expect(
        harness.fetchMock.mock.calls.some(
          ([input]) => String(input) === "https://hub-api.neynar.com/v1/submitMessage"
        )
      ).toBe(false);
    }
  });

  it("surfaces Neynar hub timeout errors with idempotency context", async () => {
    const idempotencyKey = "2f089f9f-8f7c-45d7-a987-c8af47795d1e";
    const signerPath = "/tmp/cli-tests/.cobuild-cli/agents/default/farcaster/ed25519-signer.json";
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
      fetchResponder: async (input) => {
        const url = String(input);
        if (url.endsWith("/api/cli/farcaster/x402-payment")) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                ok: true,
                result: {
                  xPayment: MOCK_PAYMENT_TIMEOUT,
                  agentKey: "default",
                },
              }),
          };
        }
        if (url === "https://hub-api.neynar.com/v1/submitMessage") {
          const timeoutError = new Error("aborted");
          Object.assign(timeoutError, { name: "AbortError" });
          throw timeoutError;
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });
    setHostedX402PayerConfig(harness);
    harness.files.set(
      signerPath,
      JSON.stringify(
        {
          version: 1,
          algorithm: "ed25519",
          publicKey: `0x${"11".repeat(32)}`,
          privateKeyHex: `0x${"22".repeat(32)}`,
          fid: "123",
        },
        null,
        2
      )
    );

    await expect(
      runCli(
        [
          "farcaster",
          "post",
          "--text",
          "Ship update",
          "--idempotency-key",
          idempotencyKey,
        ],
        harness.deps
      )
    ).rejects.toThrow(`Neynar hub request timed out after 30000ms (idempotency key: ${idempotencyKey})`);
  });

  it("posts signer key and stores signer secret on success", async () => {
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
          txHash: "0xsignup",
        },
      }),
    });

    await runCli(["farcaster", "signup"], harness.deps);

    const [, init] = harness.fetchMock.mock.calls[0];
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

  it("keeps signup successful without reading payer config", async () => {
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
          txHash: "0xsignup",
        },
      }),
    });
    harness.files.set(
      "/tmp/cli-tests/.cobuild-cli/agents/stored-agent/wallet/payer.json",
      "{not-json"
    );

    await runCli(["farcaster", "signup"], harness.deps);

    const output = parseLastJsonOutput(harness.outputs) as {
      signer?: { saved?: boolean };
    };
    expect(output.signer?.saved).toBe(true);
    expect(harness.errors.join("\n")).not.toContain("payer setup skipped:");
  });

  it("supports recovery and does not persist signer on needs_funding", async () => {
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
      ["farcaster", "signup", "--recovery", "0x0000000000000000000000000000000000000009"],
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

  it("passes extra storage and custom out-dir", async () => {
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
    const body = JSON.parse(String(init?.body)) as { extraStorage?: string };
    expect(body.extraStorage).toBe("2");

    const signerPath = "/tmp/cli-tests/custom-farcaster/ed25519-signer.json";
    expect(harness.files.get(signerPath)).toBeTruthy();
  });

  it("validates extra storage, recovery, and out-dir", async () => {
    const harness = createHarness();

    await expect(runCli(["farcaster", "signup", "--extra-storage", "-1"], harness.deps)).rejects.toThrow(
      "--extra-storage must be a non-negative integer"
    );
    await expect(runCli(["farcaster", "signup", "--recovery", "0xdeadbeef"], harness.deps)).rejects.toThrow(
      "--recovery must be a 20-byte hex address"
    );
    await expect(runCli(["farcaster", "signup", "--out-dir", "   "], harness.deps)).rejects.toThrow(
      "--out-dir cannot be empty"
    );
  });

  it("reports existing fid and custody for already-registered wallets", async () => {
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

    await expect(runCli(["farcaster", "signup"], harness.deps)).rejects.toThrow(
      "Farcaster account already exists for this agent wallet (fid=77, custodyAddress=0x0000000000000000000000000000000000000002). Use a different --agent key for a new Farcaster signup."
    );
  });

  it("rethrows non-conflict signup transport failures", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
      fetchResponder: async () => ({
        ok: false,
        status: 500,
        text: async () => JSON.stringify({ ok: false, error: "internal error" }),
      }),
    });

    await expect(runCli(["farcaster", "signup"], harness.deps)).rejects.toThrow(
      "Request failed (status 500): internal error"
    );
  });

  it("keeps tools get-user validation coverage", async () => {
    const harness = createHarness();
    await expect(runCli(["tools", "get-user"], harness.deps)).rejects.toThrow(
      "Invalid input: expected string, received undefined"
    );
  });
});
