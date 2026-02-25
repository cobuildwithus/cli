import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";
import { createHarness } from "./helpers.js";

const EXPLICIT_UUID = "75d6e51f-4f27-4f17-b32f-4708fdb0f3be";
const VALID_TO = "0x000000000000000000000000000000000000dEaD";

function createJsonResponder(body: unknown) {
  return async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  });
}

describe("tx network defaults", () => {
  it("uses base-sepolia when --network and COBUILD_CLI_NETWORK are missing", async () => {
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
      network: "base-sepolia",
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

  it("uses explicit --network over COBUILD_CLI_NETWORK", async () => {
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
      await runCli(["tx", "--to", VALID_TO, "--data", "0xdeadbeef", "--network", "base-sepolia"], harness.deps);
    } finally {
      if (previous === undefined) {
        delete process.env.COBUILD_CLI_NETWORK;
      } else {
        process.env.COBUILD_CLI_NETWORK = previous;
      }
    }

    const [, init] = harness.fetchMock.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toMatchObject({
      network: "base-sepolia",
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
});
