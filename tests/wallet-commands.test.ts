import { describe, expect, it } from "vitest";
import {
  executeWalletInitCommand,
  executeWalletStatusCommand,
} from "../src/wallet/commands.js";
import { createHarness } from "./helpers.js";

function setLocalWalletConfig(harness: ReturnType<typeof createHarness>, agentKey = "default"): void {
  harness.files.set(
    `/tmp/cli-tests/.cobuild-cli/agents/${agentKey}/wallet/payer.json`,
    JSON.stringify(
      {
        version: 1,
        mode: "local",
        payerAddress: "0x87F6433eae757DF1f471bF9Ce03fe32d751eaE35",
        payerRef: {
          source: "file",
          provider: "default",
          id: `/wallet:payer:${agentKey}`,
        },
        network: "base",
        token: "usdc",
        createdAt: "2026-03-03T00:00:00.000Z",
      },
      null,
      2
    )
  );
  harness.files.set(
    "/tmp/cli-tests/.cobuild-cli/secrets.json",
    JSON.stringify(
      {
        [`wallet:payer:${agentKey}`]: `0x${"01".repeat(31)}02`,
      },
      null,
      2
    )
  );
}

describe("wallet command helpers", () => {
  it("initializes wallet config with noPrompt defaulting to false", async () => {
    const harness = createHarness({
      config: {
        agent: "default",
      },
    });

    const result = await executeWalletInitCommand(
      {
        mode: "local-generate",
      },
      harness.deps
    );

    expect(result).toMatchObject({
      ok: true,
      agentKey: "default",
      walletConfig: {
        mode: "local",
        network: "base",
        token: "usdc",
        costPerPaidCallMicroUsdc: "1000",
      },
    });
  });

  it("surfaces hosted wallet lookup failures in status", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
        agent: "default",
      },
      fetchResponder: async () => ({
        ok: false,
        status: 500,
        text: async () => JSON.stringify({ ok: false, error: "internal error" }),
      }),
    });

    await expect(executeWalletStatusCommand({}, harness.deps)).rejects.toThrow(
      "Hosted wallet address is unknown and could not be fetched from backend wallet endpoint: Request failed (status 500): internal error"
    );
  });

  it("throws a deterministic error when the backend returns no hosted wallet address", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
        agent: "default",
      },
      fetchResponder: async () => ({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            ok: true,
            result: {},
          }),
      }),
    });

    await expect(executeWalletStatusCommand({}, harness.deps)).rejects.toThrow(
      "Hosted wallet address is unknown and could not be fetched from backend wallet endpoint: backend returned no address."
    );
  });

  it("writes refreshed hosted wallet address when backend lookup succeeds", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
        agent: "default",
      },
      fetchResponder: async () => ({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            ok: true,
            result: {
              ownerAccountAddress: "0x00000000000000000000000000000000000000aa",
            },
          }),
      }),
    });

    const result = await executeWalletStatusCommand({}, harness.deps);
    expect(result).toMatchObject({
      ok: true,
      walletConfig: {
        mode: "hosted",
        walletAddress: "0x00000000000000000000000000000000000000aa",
        network: "base",
        token: "usdc",
        costPerPaidCallMicroUsdc: "1000",
      },
    });

    const stored = JSON.parse(
      harness.files.get("/tmp/cli-tests/.cobuild-cli/agents/default/wallet/payer.json") ?? "{}"
    ) as { payerAddress?: string | null };
    expect(stored.payerAddress).toBe("0x00000000000000000000000000000000000000aa");
  });

  it("throws clear guidance when status is requested before wallet setup", async () => {
    const harness = createHarness();

    await expect(executeWalletStatusCommand({}, harness.deps)).rejects.toThrow(
      "No wallet is configured for this agent. Run `cli wallet init --mode hosted|local-generate|local-key`."
    );
  });

  it("returns local wallet status without backend fetches", async () => {
    const harness = createHarness({
      config: {
        agent: "default",
      },
    });
    setLocalWalletConfig(harness);

    const result = await executeWalletStatusCommand({}, harness.deps);
    expect(result).toMatchObject({
      ok: true,
      agentKey: "default",
      walletConfig: {
        mode: "local",
        walletAddress: "0x87F6433eae757DF1f471bF9Ce03fe32d751Ff9a0",
        network: "base",
        token: "usdc",
        costPerPaidCallMicroUsdc: "1000",
      },
    });
    expect(harness.fetchMock).not.toHaveBeenCalled();
  });

  it("preserves local wallet configuration errors without hosted lookup wrapping", async () => {
    const harness = createHarness({
      config: {
        agent: "default",
      },
    });
    harness.files.set(
      "/tmp/cli-tests/.cobuild-cli/agents/default/wallet/payer.json",
      JSON.stringify(
        {
          version: 1,
          mode: "local",
          payerAddress: "0x87F6433eae757DF1f471bF9Ce03fe32d751eaE35",
          network: "base",
          token: "usdc",
          createdAt: "2026-03-03T00:00:00.000Z",
        },
        null,
        2
      )
    );

    await expect(executeWalletStatusCommand({}, harness.deps)).rejects.toThrow(
      "Local payer config is missing payerRef."
    );
    expect(harness.fetchMock).not.toHaveBeenCalled();
  });

  it("skips hosted wallet fetch when payer address is already known", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
        agent: "default",
      },
      fetchResponder: async () => {
        throw new Error("fetch should not be called");
      },
    });
    harness.files.set(
      "/tmp/cli-tests/.cobuild-cli/agents/default/wallet/payer.json",
      JSON.stringify(
        {
          version: 1,
          mode: "hosted",
          payerAddress: "0x00000000000000000000000000000000000000bb",
          network: "base",
          token: "usdc",
          createdAt: "2026-03-03T00:00:00.000Z",
        },
        null,
        2
      )
    );

    const result = await executeWalletStatusCommand({}, harness.deps);
    expect(result).toMatchObject({
      walletConfig: {
        walletAddress: "0x00000000000000000000000000000000000000bb",
      },
    });
    expect(harness.fetchMock).not.toHaveBeenCalled();
  });
});
