import { describe, expect, it } from "vitest";
import { executeSetupCommand } from "../src/commands/setup.js";
import { DEFAULT_CHAT_API_URL } from "../src/config.js";
import { createHarness } from "./helpers.js";

describe("setup execute surface", () => {
  it("returns structured output without printing to stdout", async () => {
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
        walletMode: "hosted",
      },
      harness.deps
    );

    expect(result).toMatchObject({
      ok: true,
      config: {
        interfaceUrl: "https://api.example",
        chatApiUrl: DEFAULT_CHAT_API_URL,
        agent: "default",
      },
      wallet: { ok: true, address: "0xabc" },
    });
    expect(harness.outputs).toEqual([]);
  });
});
