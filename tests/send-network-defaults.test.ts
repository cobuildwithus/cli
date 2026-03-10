import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";
import { createHarness } from "./helpers.js";

const GENERATED_UUID = "8e03978e-40d5-43e8-bc93-6894a57f9324";
const VALID_TO = "0x000000000000000000000000000000000000dead";

function createJsonResponder(body: unknown) {
  return async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  });
}

describe("send network defaults", () => {
  it("uses base when --network and COBUILD_CLI_NETWORK are missing", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
        agent: "stored-agent",
      },
      fetchResponder: createJsonResponder({
        ok: true,
        txHash: "0x1",
        idempotencyKey: "server-controlled-key",
      }),
    });

    await runCli(["send", "usdc", "1.0", VALID_TO], harness.deps);

    const [, init] = harness.fetchMock.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual({
      kind: "transfer",
      network: "base",
      agentKey: "stored-agent",
      token: "usdc",
      amount: "1.0",
      to: VALID_TO,
    });
    expect(harness.errors).toEqual([]);
    expect(JSON.parse(harness.outputs.at(-1) ?? "{}")).toMatchObject({
      idempotencyKey: GENERATED_UUID,
      txHash: "0x1",
    });
  });

  it("uses COBUILD_CLI_NETWORK when --network is not provided", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
      fetchResponder: createJsonResponder({ ok: true }),
    });
    const previous = process.env.COBUILD_CLI_NETWORK;
    process.env.COBUILD_CLI_NETWORK = "base";

    try {
      await runCli(["send", "usdc", "1.0", VALID_TO], harness.deps);
    } finally {
      if (previous === undefined) {
        delete process.env.COBUILD_CLI_NETWORK;
      } else {
        process.env.COBUILD_CLI_NETWORK = previous;
      }
    }

    const [, init] = harness.fetchMock.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toMatchObject({
      network: "base",
    });
  });

  it("resolves COBUILD_CLI_NETWORK from deps.env when provided", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
      fetchResponder: createJsonResponder({ ok: true }),
    });
    harness.deps.env = {
      COBUILD_CLI_NETWORK: "base-mainnet",
    };

    const previous = process.env.COBUILD_CLI_NETWORK;
    process.env.COBUILD_CLI_NETWORK = "base-sepolia";
    try {
      await runCli(["send", "usdc", "1.0", VALID_TO], harness.deps);
    } finally {
      if (previous === undefined) {
        delete process.env.COBUILD_CLI_NETWORK;
      } else {
        process.env.COBUILD_CLI_NETWORK = previous;
      }
    }

    const [, normalizedInit] = harness.fetchMock.mock.calls[0];
    expect(JSON.parse(String(normalizedInit?.body))).toMatchObject({
      network: "base",
    });
  });

  it("rejects explicit unsupported networks before sending", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
    });

    await expect(
      runCli(["send", "usdc", "1.0", VALID_TO, "--network", "base-sepolia"], harness.deps)
    ).rejects.toThrow('Unsupported network "base-sepolia". Only "base" is supported.');

    expect(harness.fetchMock).not.toHaveBeenCalled();
  });
});
