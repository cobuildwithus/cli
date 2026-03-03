import { describe, expect, it } from "vitest";
import { executeSetupCommand } from "../src/commands/setup.js";
import { DEFAULT_CHAT_API_URL } from "../src/config.js";
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
        chatApiUrl: DEFAULT_CHAT_API_URL,
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

  it("configures hosted payer during setup when requested", async () => {
    const harness = createHarness({
      fetchResponder: async (input) => {
        const url = String(input);
        if (url.endsWith("/api/buildbot/wallet")) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ ok: true, address: "0xabc" }),
          };
        }
        if (url.endsWith("/api/buildbot/wallet?agentKey=default")) {
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
    harness.deps.isInteractive = () => false;

    const result = await executeSetupCommand(
      {
        url: "https://api.example",
        token: "bbt_secret",
        payerMode: "hosted",
      },
      harness.deps
    );

    expect(result.payer).toEqual({
      mode: "hosted",
      payerAddress: "0x00000000000000000000000000000000000000aa",
      network: "base",
      token: "usdc",
      costPerPaidCallMicroUsdc: "1000",
    });
    expect(harness.fetchMock).toHaveBeenCalledTimes(2);
  });

  it("boots wallet before hosted payer lookup", async () => {
    const requestedUrls: string[] = [];
    const harness = createHarness({
      fetchResponder: async (input) => {
        const url = String(input);
        requestedUrls.push(url);
        if (url === "https://api.example/api/buildbot/wallet") {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ ok: true, address: "0xabc" }),
          };
        }
        if (url === "https://api.example/api/buildbot/wallet?agentKey=default") {
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
    harness.deps.isInteractive = () => false;

    await executeSetupCommand(
      {
        url: "https://api.example",
        token: "bbt_secret",
        payerMode: "hosted",
      },
      harness.deps
    );

    expect(requestedUrls).toEqual([
      "https://api.example/api/buildbot/wallet",
      "https://api.example/api/buildbot/wallet?agentKey=default",
    ]);
  });

  it("rejects invalid payer mode values before any network call", async () => {
    const harness = createHarness();

    await expect(
      executeSetupCommand(
        {
          url: "https://api.example",
          token: "bbt_secret",
          payerMode: "invalid-mode",
        },
        harness.deps
      )
    ).rejects.toThrow("--payer-mode must be one of: hosted, local-generate, local-key, skip");
    expect(harness.fetchMock).not.toHaveBeenCalled();
  });
});
