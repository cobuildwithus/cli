import { describe, expect, it, vi } from "vitest";
import {
  executeWithConfiguredWallet,
  MISSING_WALLET_CONFIG_ERROR,
} from "../src/wallet/payer-config.js";
import { createHarness } from "./helpers.js";

function setHostedWalletConfig(harness: ReturnType<typeof createHarness>, agentKey = "default"): void {
  harness.files.set(
    `/tmp/cli-tests/.cobuild-cli/agents/${agentKey}/wallet/payer.json`,
    JSON.stringify(
      {
        version: 1,
        mode: "hosted",
        payerAddress: "0x00000000000000000000000000000000000000aa",
        network: "base",
        token: "usdc",
        createdAt: "2026-03-03T00:00:00.000Z",
      },
      null,
      2
    )
  );
}

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

describe("wallet payer config helper", () => {
  it("throws the shared guidance error when wallet config is missing", async () => {
    const harness = createHarness();

    await expect(
      executeWithConfiguredWallet({
        deps: harness.deps,
        currentConfig: {},
        agentKey: "default",
        onHosted: async () => ({ ok: true }),
        onLocal: async () => ({ ok: true }),
      })
    ).rejects.toThrow(MISSING_WALLET_CONFIG_ERROR);
  });

  it("routes hosted configs to onHosted", async () => {
    const harness = createHarness();
    setHostedWalletConfig(harness);
    const onHosted = vi.fn(async () => ({ ok: true, mode: "hosted" }));
    const onLocal = vi.fn(async () => ({ ok: true, mode: "local" }));

    const result = await executeWithConfiguredWallet({
      deps: harness.deps,
      currentConfig: {},
      agentKey: "default",
      onHosted,
      onLocal,
    });

    expect(result).toEqual({ ok: true, mode: "hosted" });
    expect(onHosted).toHaveBeenCalledTimes(1);
    expect(onHosted).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "hosted",
        payerAddress: "0x00000000000000000000000000000000000000aa",
      })
    );
    expect(onLocal).not.toHaveBeenCalled();
  });

  it("routes local configs to onLocal with resolved private key", async () => {
    const harness = createHarness();
    setLocalWalletConfig(harness);
    const onHosted = vi.fn(async () => ({ ok: true, mode: "hosted" }));
    const onLocal = vi.fn(async () => ({ ok: true, mode: "local" }));

    const result = await executeWithConfiguredWallet({
      deps: harness.deps,
      currentConfig: {},
      agentKey: "default",
      onHosted,
      onLocal,
    });

    expect(result).toEqual({ ok: true, mode: "local" });
    expect(onLocal).toHaveBeenCalledTimes(1);
    expect(onLocal).toHaveBeenCalledWith(
      expect.objectContaining({
        walletConfig: expect.objectContaining({
          mode: "local",
        }),
        privateKeyHex: `0x${"01".repeat(31)}02`,
      })
    );
    expect(onHosted).not.toHaveBeenCalled();
  });
});
