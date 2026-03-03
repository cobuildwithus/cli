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
      defaultNetwork: "base",
      wallet: { ok: true, address: "0xabc" },
    });

    const [input, init] = harness.fetchMock.mock.calls[0] ?? [];
    expect(String(input)).toBe("https://api.example/api/cli/wallet");
    expect(JSON.parse(String(init?.body))).toEqual({
      agentKey: "default",
      defaultNetwork: "base",
    });
  });

  it("configures hosted wallet during setup when requested", async () => {
    const harness = createHarness({
      fetchResponder: async (input) => {
        const url = String(input);
        if (url.endsWith("/api/cli/wallet")) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ ok: true, address: "0xabc" }),
          };
        }
        if (url.endsWith("/api/cli/wallet?agentKey=default")) {
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
        walletMode: "hosted",
      },
      harness.deps
    );

    expect(result.walletConfig).toEqual({
      mode: "hosted",
      walletAddress: "0x00000000000000000000000000000000000000aa",
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
        if (url === "https://api.example/api/cli/wallet") {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ ok: true, address: "0xabc" }),
          };
        }
        if (url === "https://api.example/api/cli/wallet?agentKey=default") {
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
        walletMode: "hosted",
      },
      harness.deps
    );

    expect(requestedUrls).toEqual([
      "https://api.example/api/cli/wallet",
      "https://api.example/api/cli/wallet?agentKey=default",
    ]);
  });

  it("rejects invalid wallet mode values before any network call", async () => {
    const harness = createHarness();

    await expect(
      executeSetupCommand(
        {
          url: "https://api.example",
          token: "bbt_secret",
          walletMode: "invalid-mode",
        },
        harness.deps
      )
    ).rejects.toThrow("--wallet-mode must be one of: hosted, local-generate, local-key");
    expect(harness.fetchMock).not.toHaveBeenCalled();
  });

  it("supports local-generate setup without auth token bootstrap", async () => {
    const harness = createHarness();

    const result = await executeSetupCommand(
      {
        url: "https://api.example",
        walletMode: "local-generate",
      },
      harness.deps
    );

    expect(result).toMatchObject({
      ok: true,
      config: {
        interfaceUrl: "https://api.example",
      },
      walletConfig: {
        mode: "local",
        network: "base",
        token: "usdc",
      },
    });
    expect(harness.fetchMock).not.toHaveBeenCalled();
  });

  it("rejects conflicting stdin sources in setup", async () => {
    const harness = createHarness();

    await expect(
      executeSetupCommand(
        {
          url: "https://api.example",
          tokenStdin: true,
          walletMode: "local-key",
          walletPrivateKeyStdin: true,
        },
        harness.deps
      )
    ).rejects.toThrow("Cannot combine --token-stdin with --wallet-private-key-stdin in one setup run.");
  });
});
