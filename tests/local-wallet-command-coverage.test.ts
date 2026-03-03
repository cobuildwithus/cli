import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHarness } from "./helpers.js";

const localExecMocks = vi.hoisted(() => ({
  executeLocalTransferMock: vi.fn(),
  executeLocalTxMock: vi.fn(),
  buildLocalWalletSummaryMock: vi.fn(),
}));

vi.mock("../src/wallet/local-exec.js", () => ({
  executeLocalTransfer: localExecMocks.executeLocalTransferMock,
  executeLocalTx: localExecMocks.executeLocalTxMock,
  buildLocalWalletSummary: localExecMocks.buildLocalWalletSummaryMock,
}));

import { executeSendCommand } from "../src/commands/send.js";
import { executeTxCommand } from "../src/commands/tx.js";
import { executeWalletCommand } from "../src/commands/wallet.js";

const VALID_TO = "0x000000000000000000000000000000000000dEaD";

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

describe("local wallet command coverage", () => {
  beforeEach(() => {
    localExecMocks.executeLocalTransferMock.mockReset();
    localExecMocks.executeLocalTxMock.mockReset();
    localExecMocks.buildLocalWalletSummaryMock.mockReset();
  });

  it("routes send to local transfer execution for local wallets", async () => {
    const harness = createHarness({
      config: {
        agent: "default",
      },
    });
    setLocalWalletConfig(harness);

    localExecMocks.executeLocalTransferMock.mockResolvedValue({
      ok: true,
      kind: "transfer",
      transactionHash: "0x1",
    });

    const result = await executeSendCommand(
      {
        token: "usdc",
        amount: "1",
        to: VALID_TO,
      },
      harness.deps
    );

    expect(localExecMocks.executeLocalTransferMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agentKey: "default",
        network: "base",
        token: "usdc",
        amount: "1",
        to: VALID_TO.toLowerCase(),
      })
    );
    expect(harness.fetchMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: true,
      kind: "transfer",
      idempotencyKey: "8e03978e-40d5-43e8-bc93-6894a57f9324",
    });
  });

  it("adds idempotency context when local transfer execution fails", async () => {
    const harness = createHarness({
      config: {
        agent: "default",
      },
    });
    setLocalWalletConfig(harness);

    localExecMocks.executeLocalTransferMock.mockRejectedValue(new Error("local send failed"));

    await expect(
      executeSendCommand(
        {
          token: "usdc",
          amount: "1",
          to: VALID_TO,
          idempotencyKey: "75d6e51f-4f27-4f17-b32f-4708fdb0f3be",
        },
        harness.deps
      )
    ).rejects.toThrow("local send failed (idempotency key: 75d6e51f-4f27-4f17-b32f-4708fdb0f3be)");
  });

  it("routes tx to local execution for local wallets", async () => {
    const harness = createHarness({
      config: {
        agent: "default",
      },
    });
    setLocalWalletConfig(harness);

    localExecMocks.executeLocalTxMock.mockResolvedValue({
      ok: true,
      kind: "tx",
      transactionHash: "0x2",
    });

    const result = await executeTxCommand(
      {
        to: VALID_TO,
        data: "0xdeadbeef",
      },
      harness.deps
    );

    expect(localExecMocks.executeLocalTxMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agentKey: "default",
        network: "base",
        to: VALID_TO.toLowerCase(),
        data: "0xdeadbeef",
        valueEth: "0",
      })
    );
    expect(harness.fetchMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: true,
      kind: "tx",
      idempotencyKey: "8e03978e-40d5-43e8-bc93-6894a57f9324",
    });
  });

  it("returns local wallet summary when wallet mode is local", async () => {
    const harness = createHarness({
      config: {
        agent: "default",
      },
    });
    setLocalWalletConfig(harness);

    localExecMocks.buildLocalWalletSummaryMock.mockReturnValue({
      ok: true,
      wallet: {
        address: "0x00000000000000000000000000000000000000aa",
      },
    });

    const result = await executeWalletCommand({}, harness.deps);

    expect(localExecMocks.buildLocalWalletSummaryMock).toHaveBeenCalled();
    expect(harness.fetchMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: true,
      walletConfig: {
        mode: "local",
        network: "base",
        token: "usdc",
      },
    });
  });

  it("returns hosted wallet payloads wrapped when the response is not an object", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
        agent: "default",
      },
      fetchResponder: async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify("scalar"),
      }),
    });

    const result = await executeWalletCommand({}, harness.deps);

    expect(result).toEqual({
      result: "scalar",
      walletConfig: {
        mode: "hosted",
        walletAddress: null,
        network: "base",
        token: "usdc",
        costPerPaidCallMicroUsdc: "1000",
      },
    });
  });

  it("throws clear guidance when wallet config is missing", async () => {
    const harness = createHarness();

    await expect(executeWalletCommand({}, harness.deps)).rejects.toThrow(
      "No wallet is configured for this agent. Run `cli wallet init --mode hosted|local-generate|local-key`."
    );
  });
});
