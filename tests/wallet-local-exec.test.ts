import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHarness } from "./helpers.js";

const mocks = vi.hoisted(() => ({
  sendTransactionMock: vi.fn(),
  waitForTransactionReceiptMock: vi.fn(),
}));

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: () => ({
      waitForTransactionReceipt: mocks.waitForTransactionReceiptMock,
    }),
    createWalletClient: () => ({
      sendTransaction: mocks.sendTransactionMock,
    }),
    encodeFunctionData: () => "0xfeedbeef",
    erc20Abi: [],
    formatEther: (value: bigint) => value.toString(),
    http: () => ({ transport: "http" }),
    parseEther: (value: string) => BigInt(value),
  };
});

vi.mock("viem/accounts", () => ({
  privateKeyToAccount: () => ({
    address: "0x00000000000000000000000000000000000000aa",
  }),
}));

vi.mock("viem/chains", () => ({
  base: { id: 8453 },
  baseSepolia: { id: 84532 },
}));

vi.mock("@cobuild/wire", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@cobuild/wire")>();
  return {
    ...actual,
    defaultRpcUrlForNetwork: (network: string) => `https://${network}.rpc.example`,
    normalizeCliWalletNetwork: (network: string) => {
      if (network === "base" || network === "base-sepolia") return network;
      throw new Error(`Unsupported network: ${network}`);
    },
    normalizeCliWalletSendToken: (token: string) => token.toLowerCase(),
    parseCliWalletSendAmountAtomic: ({ amount }: { amount: string }) => BigInt(amount),
    usdcContractForNetwork: (network: string) =>
      network === "base"
        ? "0x0000000000000000000000000000000000000013"
        : "0x0000000000000000000000000000000000000014",
  };
});

import {
  buildLocalWalletSummary,
  executeLocalTransfer,
  executeLocalTx,
  formatNeedsFundingResult,
} from "../src/wallet/local-exec.js";

const PRIVATE_KEY = `0x${"11".repeat(32)}` as `0x${string}`;
const TO = "0x000000000000000000000000000000000000dEaD" as `0x${string}`;

function receiptPath(agentKey: string, idempotencyKey: string): string {
  return `/tmp/cli-tests/.cobuild-cli/agents/${agentKey}/wallet/exec/${idempotencyKey}.json`;
}

describe("wallet local exec", () => {
  beforeEach(() => {
    mocks.sendTransactionMock.mockReset();
    mocks.waitForTransactionReceiptMock.mockReset();
  });

  it("executes ETH transfers and replays matching idempotency receipts", async () => {
    const harness = createHarness();
    mocks.sendTransactionMock.mockResolvedValue("0xabc");
    mocks.waitForTransactionReceiptMock.mockResolvedValue({ status: "success" });

    const first = await executeLocalTransfer({
      deps: harness.deps,
      agentKey: "default",
      privateKeyHex: PRIVATE_KEY,
      network: "base",
      token: "eth",
      amount: "1",
      to: TO,
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
    });

    expect(first).toMatchObject({
      ok: true,
      kind: "transfer",
      transactionHash: "0xabc",
      explorerUrl: "https://basescan.org/tx/0xabc",
    });

    const replayed = await executeLocalTransfer({
      deps: harness.deps,
      agentKey: "default",
      privateKeyHex: PRIVATE_KEY,
      network: "base",
      token: "eth",
      amount: "1",
      to: TO,
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
    });

    expect(replayed).toMatchObject({
      ok: true,
      kind: "transfer",
      replayed: true,
      transactionHash: "0xabc",
    });
    expect(mocks.sendTransactionMock).toHaveBeenCalledTimes(1);
  });

  it("executes token transfers and rejects zero amounts", async () => {
    const harness = createHarness();
    mocks.sendTransactionMock.mockResolvedValue("0xdef");
    mocks.waitForTransactionReceiptMock.mockResolvedValue({ status: "success" });

    const transfer = await executeLocalTransfer({
      deps: harness.deps,
      agentKey: "alice",
      privateKeyHex: PRIVATE_KEY,
      network: "base-sepolia",
      token: "usdc",
      amount: "2",
      to: TO,
      idempotencyKey: "22222222-2222-4222-8222-222222222222",
    });

    expect(transfer).toMatchObject({
      ok: true,
      kind: "transfer",
      transactionHash: "0xdef",
      explorerUrl: "https://sepolia.basescan.org/tx/0xdef",
    });

    await expect(
      executeLocalTransfer({
        deps: harness.deps,
        agentKey: "alice",
        privateKeyHex: PRIVATE_KEY,
        network: "base",
        token: "eth",
        amount: "0",
        to: TO,
        idempotencyKey: "33333333-3333-4333-8333-333333333333",
      })
    ).rejects.toThrow("amount must be greater than 0");
  });

  it("rejects conflicting idempotency receipts and malformed receipt content", async () => {
    const harness = createHarness();
    mocks.sendTransactionMock.mockResolvedValue("0x123");
    mocks.waitForTransactionReceiptMock.mockResolvedValue({ status: "success" });

    await executeLocalTransfer({
      deps: harness.deps,
      agentKey: "default",
      privateKeyHex: PRIVATE_KEY,
      network: "base",
      token: "eth",
      amount: "1",
      to: TO,
      idempotencyKey: "44444444-4444-4444-8444-444444444444",
    });

    await expect(
      executeLocalTransfer({
        deps: harness.deps,
        agentKey: "default",
        privateKeyHex: PRIVATE_KEY,
        network: "base",
        token: "eth",
        amount: "9",
        to: TO,
        idempotencyKey: "44444444-4444-4444-8444-444444444444",
      })
    ).rejects.toThrow("Idempotency key is already associated with a different local wallet request.");

    harness.files.set(receiptPath("default", "55555555-5555-4555-8555-555555555555"), "{bad-json");
    await expect(
      executeLocalTransfer({
        deps: harness.deps,
        agentKey: "default",
        privateKeyHex: PRIVATE_KEY,
        network: "base",
        token: "eth",
        amount: "1",
        to: TO,
        idempotencyKey: "55555555-5555-4555-8555-555555555555",
      })
    ).rejects.toThrow("Wallet local execution idempotency receipt contains invalid JSON.");

    harness.files.set(
      receiptPath("default", "66666666-6666-4666-8666-666666666666"),
      JSON.stringify({ version: 1, invalid: true })
    );
    await expect(
      executeLocalTransfer({
        deps: harness.deps,
        agentKey: "default",
        privateKeyHex: PRIVATE_KEY,
        network: "base",
        token: "eth",
        amount: "1",
        to: TO,
        idempotencyKey: "66666666-6666-4666-8666-666666666666",
      })
    ).rejects.toThrow("Wallet local execution idempotency receipt has invalid shape.");
  });

  it("executes generic tx calls and handles reverts", async () => {
    const harness = createHarness();

    mocks.sendTransactionMock.mockResolvedValue("0xtx1");
    mocks.waitForTransactionReceiptMock.mockResolvedValue({ status: "success" });
    const tx = await executeLocalTx({
      deps: harness.deps,
      agentKey: "default",
      privateKeyHex: PRIVATE_KEY,
      network: "base",
      to: TO,
      valueEth: "0",
      data: "0xdeadbeef",
      idempotencyKey: "77777777-7777-4777-8777-777777777777",
    });

    expect(tx).toMatchObject({
      ok: true,
      kind: "tx",
      transactionHash: "0xtx1",
    });

    const replay = await executeLocalTx({
      deps: harness.deps,
      agentKey: "default",
      privateKeyHex: PRIVATE_KEY,
      network: "base",
      to: TO,
      valueEth: "0",
      data: "0xdeadbeef",
      idempotencyKey: "77777777-7777-4777-8777-777777777777",
    });
    expect(replay).toMatchObject({ replayed: true, transactionHash: "0xtx1" });

    mocks.sendTransactionMock.mockResolvedValue("0xtx2");
    mocks.waitForTransactionReceiptMock.mockResolvedValue({ status: "reverted" });
    await expect(
      executeLocalTx({
        deps: harness.deps,
        agentKey: "default",
        privateKeyHex: PRIVATE_KEY,
        network: "base",
        to: TO,
        valueEth: "1",
        data: "0xdeadbeef",
        idempotencyKey: "88888888-8888-4888-8888-888888888888",
      })
    ).rejects.toThrow("Local wallet transaction reverted (tx: 0xtx2).");
  });

  it("builds local wallet summary and funding formatting payloads", () => {
    expect(
      buildLocalWalletSummary({
        agentKey: "default",
        network: "base",
        privateKeyHex: PRIVATE_KEY,
      })
    ).toEqual({
      ok: true,
      wallet: {
        ownerAddress: "0x00000000000000000000000000000000000000aa",
        agentKey: "default",
        address: "0x00000000000000000000000000000000000000aa",
        defaultNetwork: "base",
      },
    });

    expect(
      formatNeedsFundingResult({
        priceWei: 7n,
        balanceWei: 2n,
        requiredWei: 5n,
      })
    ).toEqual({
      idGatewayPriceWei: "7",
      idGatewayPriceEth: "7",
      balanceWei: "2",
      balanceEth: "2",
      requiredWei: "5",
      requiredEth: "5",
    });
  });
});
