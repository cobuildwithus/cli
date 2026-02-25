import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";
import { createHarness } from "./helpers.js";

const VALID_LOWERCASE_TO = "0x000000000000000000000000000000000000dead";

function createJsonResponder(body: unknown, status = 200) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  });
}

describe("viem validation coverage audit", () => {
  it("send accepts lowercase non-checksummed addresses", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
      fetchResponder: createJsonResponder({ ok: true, txHash: "0x1" }),
    });

    await runCli(["send", "usdc", "1.0", VALID_LOWERCASE_TO], harness.deps);

    expect(harness.fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = harness.fetchMock.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toMatchObject({
      kind: "transfer",
      to: VALID_LOWERCASE_TO,
    });
  });

  it("tx rejects calldata with non-hex characters", async () => {
    const harness = createHarness();

    await expect(runCli(["tx", "--to", VALID_LOWERCASE_TO, "--data", "0xzz"], harness.deps)).rejects.toThrow(
      "--data must be a hex string with even length"
    );
    expect(harness.fetchMock).not.toHaveBeenCalled();
  });

  it("tx accepts empty calldata represented as 0x", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
      fetchResponder: createJsonResponder({ ok: true, hash: "0x2" }),
    });

    await runCli(["tx", "--to", VALID_LOWERCASE_TO, "--data", "0x"], harness.deps);

    expect(harness.fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = harness.fetchMock.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toMatchObject({
      kind: "tx",
      to: VALID_LOWERCASE_TO,
      data: "0x",
    });
  });
});
