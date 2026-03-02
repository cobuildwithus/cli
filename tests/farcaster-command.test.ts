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
          registerTxHash: "0xregister",
          addKeyTxHash: "0xadd",
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
    const savedSigner = JSON.parse(harness.files.get(signerPath) ?? "{}") as {
      publicKey?: string;
      privateKeyHex?: string;
      fid?: string;
      network?: string;
    };
    expect(savedSigner.publicKey).toBe(body.signerPublicKey);
    expect(savedSigner.privateKeyHex).toMatch(/^0x[0-9a-f]{64}$/);
    expect(savedSigner.fid).toBe("123");
    expect(savedSigner.network).toBe("optimism");
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

  it("keeps tools get-user validation coverage", async () => {
    const harness = createHarness();
    await expect(runCli(["tools", "get-user"], harness.deps)).rejects.toThrow("Usage:");
  });
});
