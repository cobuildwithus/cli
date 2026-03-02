import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";
import { createHarness } from "./helpers.js";

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

describe("farcaster command", () => {
  it("requires a subcommand, supports --help, and rejects unknown subcommands", async () => {
    const harness = createHarness();

    await expect(runCli(["farcaster"], harness.deps)).rejects.toThrow("Usage:");
    await expect(runCli(["farcaster", "--help"], harness.deps)).rejects.toThrow("Usage:");
    await expect(runCli(["farcaster", "unknown"], harness.deps)).rejects.toThrow(
      "Unknown farcaster subcommand: unknown"
    );
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
        if (url.endsWith("/api/buildbot/farcaster/x402-payment")) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                ok: true,
                result: {
                  xPayment: "payment-1",
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
            "X-PAYMENT": "payment-1",
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
    expect(receipt.messageBytesBase64).toMatch(/^[A-Za-z0-9+/=]+$/);
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
        if (url.endsWith("/api/buildbot/farcaster/x402-payment")) {
          x402Calls += 1;
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                ok: true,
                result: {
                  xPayment: `payment-${x402Calls}`,
                  agentKey: "default",
                  payerAddress: "0x0000000000000000000000000000000000000007",
                },
              }),
          };
        }
        if (url === "https://hub-api.neynar.com/v1/submitMessage") {
          hubCalls += 1;
          if (hubCalls === 1) {
            expect(init?.headers).toMatchObject({ "X-PAYMENT": "payment-1" });
            return { ok: false, status: 402, text: async () => "payment required" };
          }
          expect(init?.headers).toMatchObject({ "X-PAYMENT": "payment-2" });
          return { ok: true, status: 200, text: async () => "{\"ok\":true}" };
        }
        throw new Error(`Unexpected URL: ${url}`);
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
        if (url.endsWith("/api/buildbot/farcaster/x402-payment")) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                ok: true,
                result: {
                  xPayment: "payment-resume",
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
      `Neynar hub rejected Farcaster cast submit (status 500): temporary failure (idempotency key: ${idempotencyKey})`
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

  it("verifies cast inclusion with --verify and returns verification metadata", async () => {
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
        if (url.endsWith("/api/buildbot/farcaster/x402-payment")) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                ok: true,
                result: {
                  xPayment: "payment-verify",
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
            return {
              ok: false,
              status: 404,
              text: async () => "not found",
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
        "--verify",
      ],
      harness.deps
    );

    const output = parseLastJsonOutput(harness.outputs) as {
      result?: {
        verification?: { enabled?: boolean; included?: boolean; attempts?: number };
      };
    };
    expect(verifyCalls).toBe(2);
    expect(output.result?.verification).toEqual({
      enabled: true,
      included: true,
      attempts: 2,
    });
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
      "--fid must be a positive integer"
    );

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
    ).rejects.toThrow("--fid must be a positive integer");
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
        if (url.endsWith("/api/buildbot/farcaster/x402-payment")) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                ok: true,
                result: {
                  xPayment: "payment-override",
                  agentKey: "default",
                },
              }),
          };
        }
        if (url === "https://hub-api.neynar.com/v1/submitMessage") {
          expect(init?.headers).toMatchObject({ "X-PAYMENT": "payment-override" });
          return { ok: true, status: 200, text: async () => "accepted" };
        }
        throw new Error(`Unexpected URL: ${url}`);
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
        if (url.endsWith("/api/buildbot/farcaster/x402-payment")) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                ok: true,
                result: {
                  xPayment: "payment-migrate",
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
        if (url.endsWith("/api/buildbot/farcaster/x402-payment")) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                ok: true,
                result: {
                  xPayment: "payment-1",
                  agentKey: "token-agent",
                },
              }),
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });
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
        if (url.endsWith("/api/buildbot/farcaster/x402-payment")) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ ok: true, result: {} }),
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
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
      if (url.endsWith("/api/buildbot/farcaster/x402-payment")) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ ok: true, result: { xPayment: "payment-1" } }),
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
      if (url.endsWith("/api/buildbot/farcaster/x402-payment")) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({ ok: true, result: { xPayment: "payment-1", agentKey: "default" } }),
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
    ).rejects.toThrow(/Neynar hub rejected Farcaster cast submit \(status 500\): hub failed/);
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
        if (url.endsWith("/api/buildbot/farcaster/x402-payment")) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                ok: true,
                result: {
                  xPayment: "payment-timeout",
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
    await expect(runCli(["tools", "get-user"], harness.deps)).rejects.toThrow("Usage:");
  });
});
