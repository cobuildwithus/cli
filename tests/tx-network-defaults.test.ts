import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";
import { createHarness } from "./helpers.js";

const EXPLICIT_UUID = "75d6e51f-4f27-4f17-b32f-4708fdb0f3be";
const VALID_TO = "0x000000000000000000000000000000000000dead";

function createJsonResponder(body: unknown) {
  return async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  });
}

describe("tx network defaults", () => {
  it("uses base when --network and COBUILD_CLI_NETWORK are missing", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
      fetchResponder: createJsonResponder({ ok: true, hash: "0x2" }),
    });

    await runCli(
      ["tx", "--to", VALID_TO, "--data", "0xdeadbeef", "--idempotency-key", EXPLICIT_UUID],
      harness.deps
    );

    const [, init] = harness.fetchMock.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual({
      kind: "tx",
      network: "base",
      agentKey: "default",
      to: VALID_TO,
      data: "0xdeadbeef",
      valueEth: "0",
    });
    expect(harness.errors).toEqual([]);
    expect(JSON.parse(harness.outputs.at(-1) ?? "{}")).toMatchObject({
      idempotencyKey: EXPLICIT_UUID,
    });
  });

  it("rejects unsupported explicit networks after the Base-only cutover", async () => {
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
      await expect(
        runCli(["tx", "--to", VALID_TO, "--data", "0xdeadbeef", "--network", "base-sepolia"], harness.deps)
      ).rejects.toThrow('Unsupported network "base-sepolia". Only "base" is supported.');
    } finally {
      if (previous === undefined) {
        delete process.env.COBUILD_CLI_NETWORK;
      } else {
        process.env.COBUILD_CLI_NETWORK = previous;
      }
    }
    expect(harness.fetchMock).not.toHaveBeenCalled();
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
      await runCli(["tx", "--to", VALID_TO, "--data", "0xdeadbeef"], harness.deps);
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
      await runCli(["tx", "--to", VALID_TO, "--data", "0xdeadbeef"], harness.deps);
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

  it("preserves pending hosted tx responses", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
      fetchResponder: createJsonResponder({
        ok: true,
        pending: true,
        status: "pending",
        transactionHash: null,
        userOpHash: "0xpending-tx",
      }),
    });

    await runCli(
      ["tx", "--to", VALID_TO, "--data", "0xdeadbeef", "--idempotency-key", EXPLICIT_UUID],
      harness.deps
    );

    expect(JSON.parse(harness.outputs.at(-1) ?? "{}")).toMatchObject({
      ok: true,
      pending: true,
      status: "pending",
      transactionHash: null,
      userOpHash: "0xpending-tx",
      idempotencyKey: EXPLICIT_UUID,
    });
  });

  it("preserves dry-run output shape for JSON tx input", async () => {
    const harness = createHarness({
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
          idempotencyKey: EXPLICIT_UUID,
        }),
        "--dry-run",
      ],
      harness.deps
    );

    expect(harness.fetchMock).not.toHaveBeenCalled();
    expect(JSON.parse(harness.outputs.at(-1) ?? "{}")).toEqual({
      ok: true,
      dryRun: true,
      idempotencyKey: EXPLICIT_UUID,
      request: {
        method: "POST",
        path: "/api/cli/exec",
        body: {
          kind: "tx",
          network: "base",
          agentKey: "default",
          to: VALID_TO,
          data: "0xdeadbeef",
          valueEth: "0",
        },
      },
    });
  });
});
