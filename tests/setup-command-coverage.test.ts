import { describe, expect, it } from "vitest";
import { executeSetupCommand } from "../src/commands/setup.js";
import { createHarness } from "./helpers.js";

describe("setup command coverage", () => {
  it("executes structured setup flow via executeSetupCommand", async () => {
    const harness = createHarness({
      fetchResponder: async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true, address: "0xabc" }),
      }),
    });

    const result = await executeSetupCommand(
      {
        url: "https://api.example",
        token: "bbt_secret",
      },
      harness.deps
    );

    expect(result).toMatchObject({
      ok: true,
      config: {
        interfaceUrl: "https://api.example",
        agent: "default",
      },
      defaultNetwork: "base-sepolia",
      wallet: { ok: true, address: "0xabc" },
    });

    const [input, init] = harness.fetchMock.mock.calls[0] ?? [];
    expect(String(input)).toBe("https://api.example/api/buildbot/wallet");
    expect(JSON.parse(String(init?.body))).toEqual({
      agentKey: "default",
      defaultNetwork: "base-sepolia",
    });
  });
});
