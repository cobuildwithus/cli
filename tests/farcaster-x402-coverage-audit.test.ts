import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";
import { createHarness } from "./helpers.js";

function parseLastJsonOutput(outputs: string[]): unknown {
  return JSON.parse(outputs.at(-1) ?? "null");
}

function setHostedX402PayerConfig(
  harness: ReturnType<typeof createHarness>,
  payerAddress: string | null
): void {
  harness.files.set(
    "/tmp/cli-tests/.cobuild-cli/agents/default/farcaster/x402-payer.json",
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

describe("farcaster x402 coverage audit", () => {
  it("initializes hosted payer from wallet.address payloads", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
      fetchResponder: async (input) => {
        const url = String(input);
        if (url === "https://api.example/api/buildbot/wallet?agentKey=default") {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                ok: true,
                result: {
                  wallet: {
                    address: "0x00000000000000000000000000000000000000bb",
                  },
                },
              }),
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });

    await runCli(["farcaster", "x402", "init", "--mode", "hosted", "--no-prompt"], harness.deps);

    expect(parseLastJsonOutput(harness.outputs)).toMatchObject({
      ok: true,
      agentKey: "default",
      x402: {
        mode: "hosted",
        payerAddress: "0x00000000000000000000000000000000000000bb",
      },
    });
    const persisted = JSON.parse(
      harness.files.get("/tmp/cli-tests/.cobuild-cli/agents/default/farcaster/x402-payer.json") ?? "{}"
    ) as { mode?: string; payerAddress?: string | null };
    expect(persisted.mode).toBe("hosted");
    expect(persisted.payerAddress).toBe("0x00000000000000000000000000000000000000bb");
  });

  it("rejects empty private key stdin values in local-key mode", async () => {
    const harness = createHarness();
    harness.deps.readStdin = async () => " \n ";

    await expect(
      runCli(
        [
          "farcaster",
          "x402",
          "init",
          "--mode",
          "local-key",
          "--private-key-stdin",
          "--no-prompt",
        ],
        harness.deps
      )
    ).rejects.toThrow("Private key stdin input is empty.");
  });

  it("returns explicit verify=once guidance when cast is still missing", async () => {
    const signerPath = "/tmp/cli-tests/.cobuild-cli/agents/default/farcaster/ed25519-signer.json";
    const idempotencyKey = "3f5d7776-6287-4f24-ae18-865365f68fd7";
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
                  xPayment: "payment-verify-once-404",
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
          return {
            ok: false,
            status: 404,
            text: async () => "missing",
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });
    setHostedX402PayerConfig(harness, "0x0000000000000000000000000000000000000009");
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
          "--verify=once",
        ],
        harness.deps
      )
    ).rejects.toThrow(
      `Cast was not observed in Neynar hub read after one delayed verification check (idempotency key: ${idempotencyKey})`
    );
  });

  it("warns on verification paywall and uses hosted payment header when cast reads return 402", async () => {
    const signerPath = "/tmp/cli-tests/.cobuild-cli/agents/default/farcaster/ed25519-signer.json";
    let castByIdCalls = 0;
    let x402Calls = 0;
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
                  xPayment: "payment-verify-hosted-402",
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
          castByIdCalls += 1;
          if (castByIdCalls === 1) {
            return {
              ok: false,
              status: 402,
              text: async () => "payment required",
            };
          }
          expect((init?.headers as Record<string, string>)["X-PAYMENT"]).toBe("payment-verify-hosted-402");
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ ok: true }),
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });
    setHostedX402PayerConfig(harness, "0x0000000000000000000000000000000000000009");
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

    await runCli(["farcaster", "post", "--text", "Ship update", "--verify=once"], harness.deps);

    expect(castByIdCalls).toBe(2);
    expect(x402Calls).toBe(2);
    expect(
      harness.errors.some((line) =>
        line.includes(
          "Verification reads hit Neynar hub paywall (HTTP 402); verification calls may cost 0.001 USDC each."
        )
      )
    ).toBe(true);
  });
});
