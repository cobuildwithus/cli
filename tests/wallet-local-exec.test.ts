import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHarness } from "./helpers.js";

const mocks = vi.hoisted(() => ({
  prepareTransactionRequestMock: vi.fn(),
  signTransactionMock: vi.fn(),
  sendRawTransactionMock: vi.fn(),
  waitForTransactionReceiptMock: vi.fn(),
}));

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: () => ({
      sendRawTransaction: mocks.sendRawTransactionMock,
      waitForTransactionReceipt: mocks.waitForTransactionReceiptMock,
    }),
    createWalletClient: () => ({
      prepareTransactionRequest: mocks.prepareTransactionRequestMock,
      sendRawTransaction: mocks.sendRawTransactionMock,
    }),
    encodeFunctionData: () => "0xfeedbeef",
    erc20Abi: [],
    formatEther: (value: bigint) => value.toString(),
    http: () => ({ transport: "http" }),
    keccak256: (value: `0x${string}`) => value,
    parseEther: (value: string) => BigInt(value),
  };
});

vi.mock("viem/accounts", () => ({
  privateKeyToAccount: () => ({
    address: "0x00000000000000000000000000000000000000aa",
    signTransaction: mocks.signTransactionMock,
  }),
}));

vi.mock("viem/chains", () => ({
  base: { id: 8453 },
}));

vi.mock("@cobuild/wire", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@cobuild/wire")>();
  return {
    ...actual,
    defaultRpcUrlForNetwork: (network: string) => `https://${network}.rpc.example`,
    normalizeCliWalletNetwork: (network: string) => {
      if (network === "base" || network === "base-mainnet") return "base";
      if (network === "base-sepolia") return "base-sepolia";
      throw new Error(`Unsupported network: ${network}`);
    },
    normalizeCliWalletSendToken: (token: string) => token.toLowerCase(),
    parseCliWalletSendAmountAtomic: ({ amount }: { amount: string }) => BigInt(amount),
    usdcContractForNetwork: () => "0x0000000000000000000000000000000000000013",
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

function setPreparedTransaction(txHash: `0x${string}`): void {
  mocks.prepareTransactionRequestMock.mockResolvedValue({
    to: TO,
    value: 0n,
  });
  mocks.signTransactionMock.mockResolvedValue(txHash);
}

function receiptPath(agentKey: string, idempotencyKey: string): string {
  return `/tmp/cli-tests/.cobuild-cli/agents/${agentKey}/wallet/exec/${idempotencyKey}.json`;
}

function lockPath(agentKey: string, idempotencyKey: string): string {
  return `${receiptPath(agentKey, idempotencyKey)}.lock`;
}

function lockStatePath(agentKey: string, idempotencyKey: string, ownerId: string): string {
  return `${lockPath(agentKey, idempotencyKey)}.${ownerId}`;
}

function seedLockfile(
  harness: ReturnType<typeof createHarness>,
  params: {
    agentKey: string;
    idempotencyKey: string;
    lockfile: Record<string, unknown> & { ownerId: string };
  }
): void {
  harness.files.set(
    lockPath(params.agentKey, params.idempotencyKey),
    JSON.stringify(
      {
        version: 1,
        ownerId: params.lockfile.ownerId,
      },
      null,
      2
    )
  );
  harness.files.set(
    lockStatePath(params.agentKey, params.idempotencyKey, params.lockfile.ownerId),
    JSON.stringify(params.lockfile, null, 2)
  );
}

function enableExclusiveLockWrites(
  harness: ReturnType<typeof createHarness>
): ReturnType<typeof createHarness> {
  const originalWriteFileSync = harness.deps.fs.writeFileSync;
  harness.deps.fs.writeFileSync = (file, data, options) => {
    const flag =
      typeof options === "object" && options !== null
        ? (options as { flag?: string }).flag
        : undefined;
    if (flag === "wx" && harness.files.has(file)) {
      const error = new Error(`EEXIST: ${file}`) as Error & { code?: string };
      error.code = "EEXIST";
      throw error;
    }
    originalWriteFileSync(file, data, options as never);
  };
  return harness;
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function readPersistedReceipt(
  harness: ReturnType<typeof createHarness>,
  agentKey: string,
  idempotencyKey: string
): Record<string, unknown> {
  const raw = harness.files.get(receiptPath(agentKey, idempotencyKey));
  if (!raw) {
    throw new Error(`Missing receipt for ${agentKey}/${idempotencyKey}`);
  }
  return JSON.parse(raw) as Record<string, unknown>;
}

function enableStrictDirectoryWrites(
  harness: ReturnType<typeof createHarness>
): ReturnType<typeof createHarness> {
  const directories = new Set<string>();
  const originalExistsSync = harness.deps.fs.existsSync;
  const originalMkdirSync = harness.deps.fs.mkdirSync;
  const originalWriteFileSync = harness.deps.fs.writeFileSync;
  const originalRenameSync = harness.deps.fs.renameSync;

  const normalizePath = (value: string) => path.posix.normalize(value);
  const addDirectoryTree = (directory: string) => {
    const normalized = normalizePath(directory);
    const parts = normalized.split("/").filter(Boolean);
    let current = normalized.startsWith("/") ? "/" : ".";
    directories.add(current);
    for (const part of parts) {
      current = current === "/" ? `/${part}` : `${current}/${part}`;
      directories.add(current);
    }
  };
  const assertParentDirectory = (filePath: string) => {
    const parentDirectory = path.posix.dirname(normalizePath(filePath));
    if (directories.has(parentDirectory)) {
      return;
    }
    const error = new Error(`ENOENT: ${parentDirectory}`) as Error & { code?: string };
    error.code = "ENOENT";
    throw error;
  };

  addDirectoryTree("/tmp/cli-tests");

  harness.deps.fs.existsSync = (target) => {
    const normalized = normalizePath(target);
    return directories.has(normalized) || originalExistsSync(target);
  };
  harness.deps.fs.mkdirSync = (directory, options) => {
    addDirectoryTree(directory);
    originalMkdirSync(directory, options);
  };
  harness.deps.fs.writeFileSync = (file, data, options) => {
    assertParentDirectory(file);
    originalWriteFileSync(file, data, options as never);
  };
  if (originalRenameSync) {
    harness.deps.fs.renameSync = (oldPath, newPath) => {
      assertParentDirectory(newPath);
      originalRenameSync(oldPath, newPath);
    };
  }

  return harness;
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function injectPartialLockWrite(
  harness: ReturnType<typeof createHarness>,
  params: {
    match: (value: { file: string; flag?: string }) => boolean;
    onPartialWrite: () => void;
  }
): ReturnType<typeof createHarness> {
  const originalWriteFileSync = harness.deps.fs.writeFileSync;
  let triggered = false;

  harness.deps.fs.writeFileSync = (file, data, options) => {
    const flag =
      typeof options === "object" && options !== null
        ? (options as { flag?: string }).flag
        : undefined;
    if (!triggered && params.match({ file, flag })) {
      triggered = true;
      harness.files.set(file, '{"version":1');
      params.onPartialWrite();
      if (flag === "wx") {
        harness.files.delete(file);
      }
    }
    originalWriteFileSync(file, data, options as never);
  };

  return harness;
}

describe("wallet local exec", () => {
  beforeEach(() => {
    mocks.prepareTransactionRequestMock.mockReset();
    mocks.signTransactionMock.mockReset();
    mocks.sendRawTransactionMock.mockReset();
    mocks.waitForTransactionReceiptMock.mockReset();
  });

  it("executes ETH transfers and replays matching idempotency receipts", async () => {
    const harness = createHarness();
    setPreparedTransaction("0xabc");
    mocks.sendRawTransactionMock.mockResolvedValue("0xabc");
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
    expect(mocks.prepareTransactionRequestMock).toHaveBeenCalledTimes(1);
    expect(mocks.signTransactionMock).toHaveBeenCalledTimes(1);
    expect(mocks.sendRawTransactionMock).toHaveBeenCalledTimes(1);
  });

  it("executes token transfers and rejects zero amounts", async () => {
    const harness = createHarness();
    setPreparedTransaction("0xdef");
    mocks.sendRawTransactionMock.mockResolvedValue("0xdef");
    mocks.waitForTransactionReceiptMock.mockResolvedValue({ status: "success" });

    const transfer = await executeLocalTransfer({
      deps: harness.deps,
      agentKey: "alice",
      privateKeyHex: PRIVATE_KEY,
      network: "base",
      token: "usdc",
      amount: "2",
      to: TO,
      idempotencyKey: "22222222-2222-4222-8222-222222222222",
    });

    expect(transfer).toMatchObject({
      ok: true,
      kind: "transfer",
      transactionHash: "0xdef",
      explorerUrl: "https://basescan.org/tx/0xdef",
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

  it("rejects unsupported local-exec networks after the Base-only cutover", async () => {
    const harness = createHarness();

    await expect(
      executeLocalTransfer({
        deps: harness.deps,
        agentKey: "alice",
        privateKeyHex: PRIVATE_KEY,
        network: "base-sepolia",
        token: "usdc",
        amount: "2",
        to: TO,
        idempotencyKey: "23222222-2222-4222-8222-222222222222",
      })
    ).rejects.toThrow('Unsupported network "base-sepolia". Only "base" is supported.');
  });

  it("rejects conflicting idempotency receipts and malformed receipt content", async () => {
    const harness = createHarness();
    setPreparedTransaction("0x123");
    mocks.sendRawTransactionMock.mockResolvedValue("0x123");
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

  it("persists a broadcast receipt before waiting for confirmation", async () => {
    const harness = enableExclusiveLockWrites(createHarness());
    const confirmation = createDeferred<{ status: "success" }>();
    const idempotencyKey = "67676767-6767-4676-8676-676767676767";

    setPreparedTransaction("0xbroadcast");
    mocks.sendRawTransactionMock.mockResolvedValue("0xbroadcast");
    mocks.waitForTransactionReceiptMock.mockImplementation(() => confirmation.promise);

    const execution = executeLocalTransfer({
      deps: harness.deps,
      agentKey: "default",
      privateKeyHex: PRIVATE_KEY,
      network: "base",
      token: "eth",
      amount: "1",
      to: TO,
      idempotencyKey,
    });

    await vi.waitFor(() => {
      expect(readPersistedReceipt(harness, "default", idempotencyKey)).toMatchObject({
        status: "broadcast",
        txHash: "0xbroadcast",
      });
    });

    confirmation.resolve({ status: "success" });

    await expect(execution).resolves.toMatchObject({
      ok: true,
      kind: "transfer",
      transactionHash: "0xbroadcast",
    });
    expect(readPersistedReceipt(harness, "default", idempotencyKey)).toMatchObject({
      status: "confirmed",
      txHash: "0xbroadcast",
    });
  });

  it("does not overwrite a terminal receipt that wins the first receipt write race", async () => {
    const harness = enableExclusiveLockWrites(createHarness());
    const idempotencyKey = "67676767-6767-4676-8677-676767676767";
    const targetReceiptPath = receiptPath("default", idempotencyKey);
    const originalWriteFileSync = harness.deps.fs.writeFileSync;
    let racedReceiptPersist = false;

    harness.deps.fs.writeFileSync = (file, data, options) => {
      const flag =
        typeof options === "object" && options !== null
          ? (options as { flag?: string }).flag
          : undefined;
      if (!racedReceiptPersist && file === targetReceiptPath && flag === "wx") {
        racedReceiptPersist = true;
        harness.files.set(
          targetReceiptPath,
          JSON.stringify(
            {
              version: 1,
              kind: "transfer",
              network: "base",
              to: TO.toLowerCase(),
              token: "eth",
              amount: "1",
              decimals: null,
              valueEth: null,
              data: null,
              status: "confirmed",
              txHash: "0xraceconfirmed",
              savedAt: "2026-03-12T00:00:00.000Z",
            },
            null,
            2
          )
        );
      }
      originalWriteFileSync(file, data, options as never);
    };

    setPreparedTransaction("0xraceconfirmed");
    mocks.sendRawTransactionMock.mockResolvedValue("0xraceconfirmed");

    const result = await executeLocalTransfer({
      deps: harness.deps,
      agentKey: "default",
      privateKeyHex: PRIVATE_KEY,
      network: "base",
      token: "eth",
      amount: "1",
      to: TO,
      idempotencyKey,
    });

    expect(result).toMatchObject({
      ok: true,
      kind: "transfer",
      replayed: true,
      transactionHash: "0xraceconfirmed",
    });
    expect(readPersistedReceipt(harness, "default", idempotencyKey)).toMatchObject({
      status: "confirmed",
      txHash: "0xraceconfirmed",
    });
    expect(mocks.prepareTransactionRequestMock).toHaveBeenCalledTimes(1);
    expect(mocks.signTransactionMock).toHaveBeenCalledTimes(1);
    expect(mocks.sendRawTransactionMock).toHaveBeenCalledTimes(1);
    expect(mocks.waitForTransactionReceiptMock).not.toHaveBeenCalled();
  });

  it("creates the exec directory before taking the first lock", async () => {
    const harness = enableStrictDirectoryWrites(enableExclusiveLockWrites(createHarness()));
    const idempotencyKey = "68686868-6868-4686-8686-686868686868";

    setPreparedTransaction("0xmkdir");
    mocks.sendRawTransactionMock.mockResolvedValue("0xmkdir");
    mocks.waitForTransactionReceiptMock.mockResolvedValue({ status: "success" });

    const result = await executeLocalTransfer({
      deps: harness.deps,
      agentKey: "fresh",
      privateKeyHex: PRIVATE_KEY,
      network: "base",
      token: "eth",
      amount: "1",
      to: TO,
      idempotencyKey,
    });

    expect(result).toMatchObject({
      ok: true,
      kind: "transfer",
      transactionHash: "0xmkdir",
    });
    expect(readPersistedReceipt(harness, "fresh", idempotencyKey)).toMatchObject({
      status: "confirmed",
      txHash: "0xmkdir",
    });
  });

  it("retries the same key from a persisted broadcast receipt without rebroadcasting", async () => {
    const harness = enableExclusiveLockWrites(createHarness());
    const idempotencyKey = "78787878-7878-4787-8787-787878787878";

    setPreparedTransaction("0xretry");
    mocks.sendRawTransactionMock.mockResolvedValue("0xretry");
    mocks.waitForTransactionReceiptMock
      .mockRejectedValueOnce(new Error("receipt wait failed"))
      .mockResolvedValueOnce({ status: "success" });

    await expect(
      executeLocalTx({
        deps: harness.deps,
        agentKey: "default",
        privateKeyHex: PRIVATE_KEY,
        network: "base",
        to: TO,
        valueEth: "0",
        data: "0xdeadbeef",
        idempotencyKey,
      })
    ).rejects.toThrow("receipt wait failed");

    expect(readPersistedReceipt(harness, "default", idempotencyKey)).toMatchObject({
      status: "broadcast",
      txHash: "0xretry",
    });

    const replay = await executeLocalTx({
      deps: harness.deps,
      agentKey: "default",
      privateKeyHex: PRIVATE_KEY,
      network: "base",
      to: TO,
      valueEth: "0",
      data: "0xdeadbeef",
      idempotencyKey,
    });

    expect(replay).toMatchObject({
      ok: true,
      kind: "tx",
      replayed: true,
      transactionHash: "0xretry",
    });
    expect(mocks.prepareTransactionRequestMock).toHaveBeenCalledTimes(1);
    expect(mocks.signTransactionMock).toHaveBeenCalledTimes(1);
    expect(mocks.sendRawTransactionMock).toHaveBeenCalledTimes(1);
    expect(readPersistedReceipt(harness, "default", idempotencyKey)).toMatchObject({
      status: "confirmed",
      txHash: "0xretry",
    });
  });

  it("reuses the same tx hash when the terminal receipt persistence attempt fails", async () => {
    const harness = enableExclusiveLockWrites(createHarness());
    const idempotencyKey = "78787878-7878-4787-8788-787878787878";
    const receiptFileBasename = path.posix.basename(receiptPath("default", idempotencyKey));
    const originalWriteFileSync = harness.deps.fs.writeFileSync;
    let failReceiptWrite = true;

    harness.deps.fs.writeFileSync = (file, data, options) => {
      const basename = path.posix.basename(file);
      if (
        failReceiptWrite &&
        basename.startsWith(`${receiptFileBasename}.`) &&
        !basename.startsWith(`${receiptFileBasename}.lock.`) &&
        file.endsWith(".tmp")
      ) {
        failReceiptWrite = false;
        throw new Error("receipt persistence failed");
      }
      originalWriteFileSync(file, data, options as never);
    };

    setPreparedTransaction("0xpersist");
    mocks.sendRawTransactionMock.mockResolvedValue("0xpersist");
    mocks.waitForTransactionReceiptMock.mockResolvedValue({ status: "success" });

    await expect(
      executeLocalTx({
        deps: harness.deps,
        agentKey: "default",
        privateKeyHex: PRIVATE_KEY,
        network: "base",
        to: TO,
        valueEth: "0",
        data: "0xdeadbeef",
        idempotencyKey,
      })
    ).rejects.toThrow("receipt persistence failed");

    expect(mocks.prepareTransactionRequestMock).toHaveBeenCalledTimes(1);
    expect(mocks.signTransactionMock).toHaveBeenCalledTimes(1);
    expect(mocks.sendRawTransactionMock).toHaveBeenCalledTimes(1);
    expect(readPersistedReceipt(harness, "default", idempotencyKey)).toMatchObject({
      status: "broadcast",
      txHash: "0xpersist",
    });

    const replay = await executeLocalTx({
      deps: harness.deps,
      agentKey: "default",
      privateKeyHex: PRIVATE_KEY,
      network: "base",
      to: TO,
      valueEth: "0",
      data: "0xdeadbeef",
      idempotencyKey,
    });

    expect(replay).toMatchObject({
      ok: true,
      kind: "tx",
      replayed: true,
      transactionHash: "0xpersist",
    });
    expect(mocks.prepareTransactionRequestMock).toHaveBeenCalledTimes(1);
    expect(mocks.signTransactionMock).toHaveBeenCalledTimes(1);
    expect(mocks.sendRawTransactionMock).toHaveBeenCalledTimes(1);
    expect(readPersistedReceipt(harness, "default", idempotencyKey)).toMatchObject({
      status: "confirmed",
      txHash: "0xpersist",
    });
  });

  it("treats a persisted reverted receipt as terminal on retry", async () => {
    const harness = createHarness();
    const idempotencyKey = "78787878-7878-4787-9787-787878787878";

    setPreparedTransaction("0xreverted");
    mocks.sendRawTransactionMock.mockResolvedValue("0xreverted");
    mocks.waitForTransactionReceiptMock.mockResolvedValue({ status: "reverted" });

    await expect(
      executeLocalTx({
        deps: harness.deps,
        agentKey: "default",
        privateKeyHex: PRIVATE_KEY,
        network: "base",
        to: TO,
        valueEth: "0",
        data: "0xdeadbeef",
        idempotencyKey,
      })
    ).rejects.toThrow("Local wallet transaction reverted (tx: 0xreverted).");

    expect(readPersistedReceipt(harness, "default", idempotencyKey)).toMatchObject({
      status: "reverted",
      txHash: "0xreverted",
    });
    expect(mocks.prepareTransactionRequestMock).toHaveBeenCalledTimes(1);
    expect(mocks.signTransactionMock).toHaveBeenCalledTimes(1);
    expect(mocks.sendRawTransactionMock).toHaveBeenCalledTimes(1);
    expect(mocks.waitForTransactionReceiptMock).toHaveBeenCalledTimes(1);

    mocks.waitForTransactionReceiptMock.mockClear();

    await expect(
      executeLocalTx({
        deps: harness.deps,
        agentKey: "default",
        privateKeyHex: PRIVATE_KEY,
        network: "base",
        to: TO,
        valueEth: "0",
        data: "0xdeadbeef",
        idempotencyKey,
      })
    ).rejects.toThrow("Local wallet transaction reverted (tx: 0xreverted).");

    expect(mocks.prepareTransactionRequestMock).toHaveBeenCalledTimes(1);
    expect(mocks.signTransactionMock).toHaveBeenCalledTimes(1);
    expect(mocks.sendRawTransactionMock).toHaveBeenCalledTimes(1);
    expect(mocks.waitForTransactionReceiptMock).not.toHaveBeenCalled();
  });

  it("serializes same-key concurrent invocations and broadcasts once", async () => {
    const harness = enableExclusiveLockWrites(createHarness());
    const broadcast = createDeferred<`0x${string}`>();
    const confirmation = createDeferred<{ status: "success" }>();
    const idempotencyKey = "79797979-7979-4797-8797-797979797979";

    setPreparedTransaction("0xconcurrent");
    mocks.sendRawTransactionMock.mockImplementation(() => broadcast.promise);
    mocks.waitForTransactionReceiptMock.mockImplementation(() => confirmation.promise);

    const first = executeLocalTransfer({
      deps: harness.deps,
      agentKey: "default",
      privateKeyHex: PRIVATE_KEY,
      network: "base",
      token: "eth",
      amount: "1",
      to: TO,
      idempotencyKey,
    });

    await vi.waitFor(() => {
      expect(mocks.sendRawTransactionMock).toHaveBeenCalledTimes(1);
    });

    const second = executeLocalTransfer({
      deps: harness.deps,
      agentKey: "default",
      privateKeyHex: PRIVATE_KEY,
      network: "base",
      token: "eth",
      amount: "1",
      to: TO,
      idempotencyKey,
    });

    await new Promise((resolve) => setTimeout(resolve, 75));
    expect(mocks.sendRawTransactionMock).toHaveBeenCalledTimes(1);

    broadcast.resolve("0xconcurrent");

    await vi.waitFor(() => {
      expect(readPersistedReceipt(harness, "default", idempotencyKey)).toMatchObject({
        status: "broadcast",
        txHash: "0xconcurrent",
      });
    });

    confirmation.resolve({ status: "success" });

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toMatchObject({
      ok: true,
      kind: "transfer",
      transactionHash: "0xconcurrent",
    });
    expect(firstResult).not.toHaveProperty("replayed");
    expect(secondResult).toMatchObject({
      ok: true,
      kind: "transfer",
      replayed: true,
      transactionHash: "0xconcurrent",
    });
    expect(mocks.prepareTransactionRequestMock).toHaveBeenCalledTimes(1);
    expect(mocks.signTransactionMock).toHaveBeenCalledTimes(1);
    expect(mocks.sendRawTransactionMock).toHaveBeenCalledTimes(1);
  });

  it("keeps a live same-key lock from being reaped during a slow broadcast", async () => {
    vi.useFakeTimers();
    try {
      const harness = enableExclusiveLockWrites(createHarness());
      const broadcast = createDeferred<`0x${string}`>();
      const confirmation = createDeferred<{ status: "success" }>();
      const idempotencyKey = "89898989-8989-4898-8898-898989898989";

      setPreparedTransaction("0xslow");
      mocks.sendRawTransactionMock.mockImplementation(() => broadcast.promise);
      mocks.waitForTransactionReceiptMock.mockImplementation(() => confirmation.promise);

      const first = executeLocalTransfer({
        deps: harness.deps,
        agentKey: "default",
        privateKeyHex: PRIVATE_KEY,
        network: "base",
        token: "eth",
        amount: "1",
        to: TO,
        idempotencyKey,
      });

      await vi.waitFor(() => {
        expect(mocks.sendRawTransactionMock).toHaveBeenCalledTimes(1);
      });

      const second = executeLocalTransfer({
        deps: harness.deps,
        agentKey: "default",
        privateKeyHex: PRIVATE_KEY,
        network: "base",
        token: "eth",
        amount: "1",
        to: TO,
        idempotencyKey,
      });

      await flushMicrotasks();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(mocks.sendRawTransactionMock).toHaveBeenCalledTimes(1);

      broadcast.resolve("0xslow");
      await flushMicrotasks();
      await vi.advanceTimersByTimeAsync(100);

      confirmation.resolve({ status: "success" });
      await vi.advanceTimersByTimeAsync(100);

      const [firstResult, secondResult] = await Promise.all([first, second]);
      expect(firstResult).toMatchObject({
        ok: true,
        kind: "transfer",
        transactionHash: "0xslow",
      });
      expect(secondResult).toMatchObject({
        ok: true,
        kind: "transfer",
        replayed: true,
        transactionHash: "0xslow",
      });
      expect(mocks.prepareTransactionRequestMock).toHaveBeenCalledTimes(1);
      expect(mocks.signTransactionMock).toHaveBeenCalledTimes(1);
      expect(mocks.sendRawTransactionMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a live same-key lock when another request sees a partial initial lockfile write", async () => {
    const idempotencyKey = "91919191-9191-4919-8919-919191919191";
    const targetLockPath = lockPath("default", idempotencyKey);
    let secondExecution: Promise<Awaited<ReturnType<typeof executeLocalTransfer>>> | null = null;
    const harness = injectPartialLockWrite(enableExclusiveLockWrites(createHarness()), {
      match: ({ file, flag }) => file === targetLockPath && flag === "wx",
      onPartialWrite: () => {
        secondExecution = executeLocalTransfer({
          deps: harness.deps,
          agentKey: "default",
          privateKeyHex: PRIVATE_KEY,
          network: "base",
          token: "eth",
          amount: "1",
          to: TO,
          idempotencyKey,
        });
      },
    });
    const confirmation = createDeferred<{ status: "success" }>();

    setPreparedTransaction("0xpartialcreate");
    mocks.sendRawTransactionMock.mockResolvedValue("0xpartialcreate");
    mocks.waitForTransactionReceiptMock.mockImplementation(() => confirmation.promise);

    const first = executeLocalTransfer({
      deps: harness.deps,
      agentKey: "default",
      privateKeyHex: PRIVATE_KEY,
      network: "base",
      token: "eth",
      amount: "1",
      to: TO,
      idempotencyKey,
    });

    await vi.waitFor(() => {
      expect(secondExecution).not.toBeNull();
      expect(mocks.sendRawTransactionMock).toHaveBeenCalledTimes(1);
    });
    await new Promise((resolve) => setTimeout(resolve, 75));
    expect(mocks.sendRawTransactionMock).toHaveBeenCalledTimes(1);

    confirmation.resolve({ status: "success" });

    const concurrent = secondExecution;
    if (!concurrent) {
      throw new Error("Expected concurrent execution to start during lock creation.");
    }
    const [firstResult, secondResult] = await Promise.all([first, concurrent]);
    expect(firstResult).toMatchObject({
      ok: true,
      kind: "transfer",
      transactionHash: "0xpartialcreate",
    });
    expect(secondResult).toMatchObject({
      ok: true,
      kind: "transfer",
      replayed: true,
      transactionHash: "0xpartialcreate",
    });
    expect(mocks.prepareTransactionRequestMock).toHaveBeenCalledTimes(1);
    expect(mocks.signTransactionMock).toHaveBeenCalledTimes(1);
    expect(mocks.sendRawTransactionMock).toHaveBeenCalledTimes(1);
  });

  it("keeps a live same-key lock when another request sees a partial lockfile update", async () => {
    const idempotencyKey = "92929292-9292-4929-8929-929292929292";
    const targetLockPath = lockPath("default", idempotencyKey);
    let observedUpdateWritePath: string | null = null;
    let secondExecution: Promise<Awaited<ReturnType<typeof executeLocalTransfer>>> | null = null;
    const harness = injectPartialLockWrite(enableExclusiveLockWrites(createHarness()), {
      match: ({ file, flag }) => {
        const matches =
          flag !== "wx" && (file === targetLockPath || file.startsWith(`${targetLockPath}.`));
        if (matches) {
          observedUpdateWritePath = file;
        }
        return matches;
      },
      onPartialWrite: () => {
        secondExecution = executeLocalTransfer({
          deps: harness.deps,
          agentKey: "default",
          privateKeyHex: PRIVATE_KEY,
          network: "base",
          token: "eth",
          amount: "1",
          to: TO,
          idempotencyKey,
        });
      },
    });
    const confirmation = createDeferred<{ status: "success" }>();

    setPreparedTransaction("0xpartialupdate");
    mocks.sendRawTransactionMock.mockResolvedValue("0xpartialupdate");
    mocks.waitForTransactionReceiptMock.mockImplementation(() => confirmation.promise);

    const first = executeLocalTransfer({
      deps: harness.deps,
      agentKey: "default",
      privateKeyHex: PRIVATE_KEY,
      network: "base",
      token: "eth",
      amount: "1",
      to: TO,
      idempotencyKey,
    });

    await vi.waitFor(() => {
      expect(secondExecution).not.toBeNull();
      expect(mocks.sendRawTransactionMock).toHaveBeenCalledTimes(1);
    });
    await new Promise((resolve) => setTimeout(resolve, 75));
    expect(mocks.sendRawTransactionMock).toHaveBeenCalledTimes(1);

    confirmation.resolve({ status: "success" });

    const concurrent = secondExecution;
    if (!concurrent) {
      throw new Error("Expected concurrent execution to start during lock update.");
    }
    const [firstResult, secondResult] = await Promise.all([first, concurrent]);
    expect(firstResult).toMatchObject({
      ok: true,
      kind: "transfer",
      transactionHash: "0xpartialupdate",
    });
    expect(secondResult).toMatchObject({
      ok: true,
      kind: "transfer",
      replayed: true,
      transactionHash: "0xpartialupdate",
    });
    expect(observedUpdateWritePath).not.toBeNull();
    expect(observedUpdateWritePath).not.toBe(targetLockPath);
    expect(observedUpdateWritePath).toContain(`${targetLockPath}.`);
    expect(mocks.prepareTransactionRequestMock).toHaveBeenCalledTimes(1);
    expect(mocks.signTransactionMock).toHaveBeenCalledTimes(1);
    expect(mocks.sendRawTransactionMock).toHaveBeenCalledTimes(1);
  });

  it("reaps stale unreadable locks after a full stale window and retries the request", async () => {
    vi.useFakeTimers();
    try {
      const harness = enableExclusiveLockWrites(createHarness());
      const idempotencyKey = "93939393-9393-4939-8939-939393939393";

      harness.files.set(lockPath("default", idempotencyKey), '{"version":1');

      setPreparedTransaction("0xunreadable");
      mocks.sendRawTransactionMock.mockResolvedValue("0xunreadable");
      mocks.waitForTransactionReceiptMock.mockResolvedValue({ status: "success" });

      const execution = executeLocalTransfer({
        deps: harness.deps,
        agentKey: "default",
        privateKeyHex: PRIVATE_KEY,
        network: "base",
        token: "eth",
        amount: "1",
        to: TO,
        idempotencyKey,
      });

      await flushMicrotasks();
      expect(mocks.sendRawTransactionMock).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(60_000);

      await expect(execution).resolves.toMatchObject({
        ok: true,
        kind: "transfer",
        transactionHash: "0xunreadable",
      });
      expect(mocks.prepareTransactionRequestMock).toHaveBeenCalledTimes(1);
      expect(mocks.signTransactionMock).toHaveBeenCalledTimes(1);
      expect(mocks.sendRawTransactionMock).toHaveBeenCalledTimes(1);
      expect(harness.files.has(lockPath("default", idempotencyKey))).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("recovers a stale prepared lock even when the waiter is already inside the acquire loop", async () => {
    vi.useFakeTimers();
    try {
      const idempotencyKey = "94949494-9494-4949-8949-949494949494";
      const targetLockPath = lockPath("default", idempotencyKey);
      let secondExecution: Promise<Awaited<ReturnType<typeof executeLocalTx>>> | null = null;
      const harness = injectPartialLockWrite(enableExclusiveLockWrites(createHarness()), {
        match: ({ file, flag }) => file === targetLockPath && flag === "wx",
        onPartialWrite: () => {
          secondExecution = executeLocalTx({
            deps: harness.deps,
            agentKey: "default",
            privateKeyHex: PRIVATE_KEY,
            network: "base",
            to: TO,
            valueEth: "0",
            data: "0xdeadbeef",
            idempotencyKey,
          });
        },
      });

      setPreparedTransaction("0xrecoverrace");
      mocks.sendRawTransactionMock
        .mockRejectedValueOnce(new Error("broadcast failed"))
        .mockResolvedValueOnce("0xrecoverrace");
      mocks.waitForTransactionReceiptMock.mockResolvedValue({ status: "success" });

      const first = executeLocalTx({
        deps: harness.deps,
        agentKey: "default",
        privateKeyHex: PRIVATE_KEY,
        network: "base",
        to: TO,
        valueEth: "0",
        data: "0xdeadbeef",
        idempotencyKey,
      });

      await vi.waitFor(() => {
        expect(secondExecution).not.toBeNull();
      });
      await expect(first).rejects.toThrow("broadcast failed");

      await flushMicrotasks();
      await vi.advanceTimersByTimeAsync(60_000);

      const concurrent = secondExecution;
      if (!concurrent) {
        throw new Error("Expected concurrent execution to enter the acquire loop.");
      }
      await expect(concurrent).resolves.toMatchObject({
        ok: true,
        kind: "tx",
        replayed: true,
        transactionHash: "0xrecoverrace",
      });
      expect(mocks.prepareTransactionRequestMock).toHaveBeenCalledTimes(1);
      expect(mocks.signTransactionMock).toHaveBeenCalledTimes(1);
      expect(mocks.sendRawTransactionMock).toHaveBeenCalledTimes(2);
      expect(readPersistedReceipt(harness, "default", idempotencyKey)).toMatchObject({
        status: "confirmed",
        txHash: "0xrecoverrace",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects conflicting stale locks that become readable inside the acquire loop", async () => {
    const harness = enableExclusiveLockWrites(createHarness());
    const idempotencyKey = "95959595-9595-4959-8959-959595959595";
    const targetLockPath = lockPath("default", idempotencyKey);
    const originalWriteFileSync = harness.deps.fs.writeFileSync;
    const staleTimestamp = new Date(Date.now() - 60_000).toISOString();
    let seededConflictingLock = false;

    harness.files.set(targetLockPath, '{"version":1');
    harness.deps.fs.writeFileSync = (file, data, options) => {
      const flag =
        typeof options === "object" && options !== null
          ? (options as { flag?: string }).flag
          : undefined;
      if (!seededConflictingLock && file === targetLockPath && flag === "wx") {
        seededConflictingLock = true;
        seedLockfile(harness, {
          agentKey: "default",
          idempotencyKey,
          lockfile: {
            version: 1,
            ownerId: "conflicting-stale",
            createdAt: staleTimestamp,
            heartbeatAt: staleTimestamp,
            state: "active",
            intent: {
              kind: "transfer",
              network: "base",
              to: TO.toLowerCase(),
              token: "usdc",
              amount: "2",
              decimals: null,
              valueEth: null,
              data: null,
            },
          },
        });
        const error = new Error(`EEXIST: ${file}`) as Error & { code?: string };
        error.code = "EEXIST";
        throw error;
      }
      originalWriteFileSync(file, data, options as never);
    };

    await expect(
      executeLocalTransfer({
        deps: harness.deps,
        agentKey: "default",
        privateKeyHex: PRIVATE_KEY,
        network: "base",
        token: "eth",
        amount: "1",
        to: TO,
        idempotencyKey,
      })
    ).rejects.toThrow("Idempotency key is already associated with a different local wallet request.");

    expect(mocks.prepareTransactionRequestMock).not.toHaveBeenCalled();
    expect(mocks.signTransactionMock).not.toHaveBeenCalled();
    expect(mocks.sendRawTransactionMock).not.toHaveBeenCalled();
  });

  it(
    "reaps stale valid locks without a prepared tx and retries the request",
    async () => {
      const harness = createHarness();
      const idempotencyKey = "90909090-9090-4909-8909-909090909090";
      const staleTimestamp = new Date(Date.now() - 60_000).toISOString();
      seedLockfile(harness, {
        agentKey: "default",
        idempotencyKey,
        lockfile: {
          version: 1,
          ownerId: "stale-without-prepared",
          createdAt: staleTimestamp,
          heartbeatAt: staleTimestamp,
          state: "active",
          intent: {
            kind: "transfer",
            network: "base",
            to: TO.toLowerCase(),
            token: "eth",
            amount: "1",
            decimals: null,
            valueEth: null,
            data: null,
          },
        },
      });

      setPreparedTransaction("0xstale");
      mocks.sendRawTransactionMock.mockResolvedValue("0xstale");
      mocks.waitForTransactionReceiptMock.mockResolvedValue({ status: "success" });

      const result = await executeLocalTransfer({
        deps: harness.deps,
        agentKey: "default",
        privateKeyHex: PRIVATE_KEY,
        network: "base",
        token: "eth",
        amount: "1",
        to: TO,
        idempotencyKey,
      });

      expect(result).toMatchObject({
        ok: true,
        kind: "transfer",
        transactionHash: "0xstale",
      });
      expect(mocks.prepareTransactionRequestMock).toHaveBeenCalledTimes(1);
      expect(mocks.signTransactionMock).toHaveBeenCalledTimes(1);
      expect(mocks.sendRawTransactionMock).toHaveBeenCalledTimes(1);
      expect(harness.files.has(lockPath("default", idempotencyKey))).toBe(false);
      expect(readPersistedReceipt(harness, "default", idempotencyKey)).toMatchObject({
        status: "confirmed",
        txHash: "0xstale",
      });
    },
    1_000
  );

  it("aborts stale reclaim if the observed lock records a prepared tx before takeover", async () => {
    const harness = enableExclusiveLockWrites(createHarness());
    const idempotencyKey = "90909090-9090-4909-8913-909090909090";
    const staleTimestamp = new Date(Date.now() - 60_000).toISOString();
    const oldOwnerStatePath = lockStatePath("default", idempotencyKey, "owner-one");
    const newOwnerStatePath = lockStatePath("default", idempotencyKey, "owner-two");
    const originalWriteFileSync = harness.deps.fs.writeFileSync;
    let upgradedOldLock = false;

    harness.deps.randomUUID = vi.fn<() => string>().mockReturnValue("owner-two");
    seedLockfile(harness, {
      agentKey: "default",
      idempotencyKey,
      lockfile: {
        version: 1,
        ownerId: "owner-one",
        createdAt: staleTimestamp,
        heartbeatAt: staleTimestamp,
        state: "active",
        intent: {
          kind: "transfer",
          network: "base",
          to: TO.toLowerCase(),
          token: "eth",
          amount: "1",
          decimals: null,
          valueEth: null,
          data: null,
        },
      },
    });
    harness.deps.fs.writeFileSync = (file, data, options) => {
      const flag =
        typeof options === "object" && options !== null
          ? (options as { flag?: string }).flag
          : undefined;
      if (!upgradedOldLock && file === newOwnerStatePath && flag === "wx") {
        upgradedOldLock = true;
        harness.files.set(
          oldOwnerStatePath,
          JSON.stringify(
            {
              version: 1,
              ownerId: "owner-one",
              createdAt: staleTimestamp,
              heartbeatAt: staleTimestamp,
              state: "active",
              intent: {
                kind: "transfer",
                network: "base",
                to: TO.toLowerCase(),
                token: "eth",
                amount: "1",
                decimals: null,
                valueEth: null,
                data: null,
              },
              preparedTx: {
                txHash: "0xupgraded",
                serializedTransaction: "0xupgraded",
              },
            },
            null,
            2
          )
        );
      }
      originalWriteFileSync(file, data, options as never);
    };

    mocks.sendRawTransactionMock.mockResolvedValue("0xupgraded");
    mocks.waitForTransactionReceiptMock.mockResolvedValue({ status: "success" });

    const result = await executeLocalTransfer({
      deps: harness.deps,
      agentKey: "default",
      privateKeyHex: PRIVATE_KEY,
      network: "base",
      token: "eth",
      amount: "1",
      to: TO,
      idempotencyKey,
    });

    expect(result).toMatchObject({
      ok: true,
      kind: "transfer",
      replayed: true,
      transactionHash: "0xupgraded",
    });
    expect(mocks.prepareTransactionRequestMock).not.toHaveBeenCalled();
    expect(mocks.signTransactionMock).not.toHaveBeenCalled();
    expect(mocks.sendRawTransactionMock).toHaveBeenCalledTimes(1);
    expect(mocks.sendRawTransactionMock).toHaveBeenCalledWith({
      serializedTransaction: "0xupgraded",
    });
  });

  it("aborts stale reclaim if the old owner changes state during the pointer swap", async () => {
    const harness = enableExclusiveLockWrites(createHarness());
    const idempotencyKey = "90909090-9090-4909-8914-909090909090";
    const targetLockPath = lockPath("default", idempotencyKey);
    const staleTimestamp = new Date(Date.now() - 60_000).toISOString();
    const oldOwnerStatePath = lockStatePath("default", idempotencyKey, "owner-one");
    const originalRenameSync = harness.deps.fs.renameSync;
    let upgradedOldLock = false;

    harness.deps.randomUUID = vi.fn<() => string>().mockReturnValue("owner-two");
    seedLockfile(harness, {
      agentKey: "default",
      idempotencyKey,
      lockfile: {
        version: 1,
        ownerId: "owner-one",
        createdAt: staleTimestamp,
        heartbeatAt: staleTimestamp,
        state: "active",
        intent: {
          kind: "transfer",
          network: "base",
          to: TO.toLowerCase(),
          token: "eth",
          amount: "1",
          decimals: null,
          valueEth: null,
          data: null,
        },
      },
    });
    if (!originalRenameSync) {
      throw new Error("Expected renameSync support in the test harness.");
    }
    harness.deps.fs.renameSync = (oldPath, newPath) => {
      if (!upgradedOldLock && newPath === targetLockPath && oldPath.startsWith(`${targetLockPath}.`)) {
        upgradedOldLock = true;
        harness.files.set(
          oldOwnerStatePath,
          JSON.stringify(
            {
              version: 1,
              ownerId: "owner-one",
              createdAt: staleTimestamp,
              heartbeatAt: staleTimestamp,
              state: "active",
              intent: {
                kind: "transfer",
                network: "base",
                to: TO.toLowerCase(),
                token: "eth",
                amount: "1",
                decimals: null,
                valueEth: null,
                data: null,
              },
              preparedTx: {
                txHash: "0xswaprace",
                serializedTransaction: "0xswaprace",
              },
            },
            null,
            2
          )
        );
      }
      originalRenameSync(oldPath, newPath);
    };

    mocks.sendRawTransactionMock.mockResolvedValue("0xswaprace");
    mocks.waitForTransactionReceiptMock.mockResolvedValue({ status: "success" });

    const result = await executeLocalTransfer({
      deps: harness.deps,
      agentKey: "default",
      privateKeyHex: PRIVATE_KEY,
      network: "base",
      token: "eth",
      amount: "1",
      to: TO,
      idempotencyKey,
    });

    expect(result).toMatchObject({
      ok: true,
      kind: "transfer",
      replayed: true,
      transactionHash: "0xswaprace",
    });
    expect(mocks.prepareTransactionRequestMock).not.toHaveBeenCalled();
    expect(mocks.signTransactionMock).not.toHaveBeenCalled();
    expect(mocks.sendRawTransactionMock).toHaveBeenCalledTimes(1);
    expect(mocks.sendRawTransactionMock).toHaveBeenCalledWith({
      serializedTransaction: "0xswaprace",
    });
  });

  it("fences off the original owner after a stale lock is reaped", async () => {
    vi.useFakeTimers();
    try {
      const harness = enableExclusiveLockWrites(createHarness());
      const idempotencyKey = "90909090-9090-4909-8911-909090909090";
      const firstPrepare = createDeferred<{ to: `0x${string}`; value: bigint }>();
      const ownerOneLockStatePath = lockStatePath("default", idempotencyKey, "owner-one");
      const originalWriteFileSync = harness.deps.fs.writeFileSync;
      let suspendOwnerOneHeartbeat = true;

      harness.deps.randomUUID = vi
        .fn<() => string>()
        .mockReturnValueOnce("owner-one")
        .mockReturnValue("owner-two");
      harness.deps.fs.writeFileSync = (file, data, options) => {
        const flag =
          typeof options === "object" && options !== null
            ? (options as { flag?: string }).flag
            : undefined;
        if (
          suspendOwnerOneHeartbeat &&
          flag !== "wx" &&
          file.startsWith(`${ownerOneLockStatePath}.`) &&
          file.endsWith(".tmp")
        ) {
          throw new Error("owner one paused");
        }
        originalWriteFileSync(file, data, options as never);
      };

      mocks.prepareTransactionRequestMock
        .mockImplementationOnce(() => firstPrepare.promise)
        .mockResolvedValue({ to: TO, value: 0n });
      mocks.signTransactionMock.mockResolvedValueOnce("0xsecond").mockResolvedValueOnce("0xfirst");
      mocks.sendRawTransactionMock.mockImplementation(async ({ serializedTransaction }) => {
        return serializedTransaction;
      });
      mocks.waitForTransactionReceiptMock.mockResolvedValue({ status: "success" });

      const first = executeLocalTransfer({
        deps: harness.deps,
        agentKey: "default",
        privateKeyHex: PRIVATE_KEY,
        network: "base",
        token: "eth",
        amount: "1",
        to: TO,
        idempotencyKey,
      });

      await vi.waitFor(() => {
        expect(mocks.prepareTransactionRequestMock).toHaveBeenCalledTimes(1);
      });

      const second = executeLocalTransfer({
        deps: harness.deps,
        agentKey: "default",
        privateKeyHex: PRIVATE_KEY,
        network: "base",
        token: "eth",
        amount: "1",
        to: TO,
        idempotencyKey,
      });

      await flushMicrotasks();
      await vi.advanceTimersByTimeAsync(60_000);

      await expect(second).resolves.toMatchObject({
        ok: true,
        kind: "transfer",
        transactionHash: "0xsecond",
      });
      expect(readPersistedReceipt(harness, "default", idempotencyKey)).toMatchObject({
        status: "confirmed",
        txHash: "0xsecond",
      });

      suspendOwnerOneHeartbeat = false;
      firstPrepare.resolve({ to: TO, value: 0n });
      await flushMicrotasks();

      await expect(first).resolves.toMatchObject({
        ok: true,
        kind: "transfer",
        replayed: true,
        transactionHash: "0xsecond",
      });
      expect(mocks.prepareTransactionRequestMock).toHaveBeenCalledTimes(2);
      expect(mocks.signTransactionMock).toHaveBeenCalledTimes(2);
      expect(mocks.sendRawTransactionMock).toHaveBeenCalledTimes(1);
      expect(mocks.sendRawTransactionMock).toHaveBeenCalledWith({
        serializedTransaction: "0xsecond",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it(
    "recovers stale valid locks with a prepared tx instead of reaping them",
    async () => {
      const harness = createHarness();
      const idempotencyKey = "90909090-9090-4909-8910-909090909090";
      const staleTimestamp = new Date(Date.now() - 60_000).toISOString();
      seedLockfile(harness, {
        agentKey: "default",
        idempotencyKey,
        lockfile: {
          version: 1,
          ownerId: "stale-with-prepared",
          createdAt: staleTimestamp,
          heartbeatAt: staleTimestamp,
          state: "active",
          intent: {
            kind: "transfer",
            network: "base",
            to: TO.toLowerCase(),
            token: "eth",
            amount: "1",
            decimals: null,
            valueEth: null,
            data: null,
          },
          preparedTx: {
            txHash: "0xstaleprepared",
            serializedTransaction: "0xstaleprepared",
          },
        },
      });

      mocks.sendRawTransactionMock.mockResolvedValue("0xstaleprepared");
      mocks.waitForTransactionReceiptMock.mockResolvedValue({ status: "success" });

      const result = await executeLocalTransfer({
        deps: harness.deps,
        agentKey: "default",
        privateKeyHex: PRIVATE_KEY,
        network: "base",
        token: "eth",
        amount: "1",
        to: TO,
        idempotencyKey,
      });

      expect(result).toMatchObject({
        ok: true,
        kind: "transfer",
        replayed: true,
        transactionHash: "0xstaleprepared",
      });
      expect(mocks.prepareTransactionRequestMock).not.toHaveBeenCalled();
      expect(mocks.signTransactionMock).not.toHaveBeenCalled();
      expect(mocks.sendRawTransactionMock).toHaveBeenCalledTimes(1);
      expect(mocks.sendRawTransactionMock).toHaveBeenCalledWith({
        serializedTransaction: "0xstaleprepared",
      });
      expect(readPersistedReceipt(harness, "default", idempotencyKey)).toMatchObject({
        status: "confirmed",
        txHash: "0xstaleprepared",
      });
    },
    1_000
  );

  it("replays a recovered prepared lock when the original owner resumes later", async () => {
    vi.useFakeTimers();
    try {
      const harness = enableExclusiveLockWrites(createHarness());
      const idempotencyKey = "90909090-9090-4909-8912-909090909090";
      const firstSubmit = createDeferred<`0x${string}`>();
      const ownerOneLockStatePath = lockStatePath("default", idempotencyKey, "owner-one");
      const originalWriteFileSync = harness.deps.fs.writeFileSync;
      let suspendOwnerOneHeartbeat = false;

      harness.deps.randomUUID = vi
        .fn<() => string>()
        .mockReturnValueOnce("owner-one")
        .mockReturnValue("owner-two");
      harness.deps.fs.writeFileSync = (file, data, options) => {
        const flag =
          typeof options === "object" && options !== null
            ? (options as { flag?: string }).flag
            : undefined;
        if (
          suspendOwnerOneHeartbeat &&
          flag !== "wx" &&
          file.startsWith(`${ownerOneLockStatePath}.`) &&
          file.endsWith(".tmp")
        ) {
          throw new Error("owner one paused");
        }
        originalWriteFileSync(file, data, options as never);
      };

      mocks.prepareTransactionRequestMock.mockResolvedValue({ to: TO, value: 0n });
      mocks.signTransactionMock.mockResolvedValue("0xlateprepared");
      mocks.sendRawTransactionMock
        .mockImplementationOnce(() => {
          suspendOwnerOneHeartbeat = true;
          return firstSubmit.promise;
        })
        .mockResolvedValueOnce("0xlateprepared");
      mocks.waitForTransactionReceiptMock.mockResolvedValue({ status: "success" });

      const first = executeLocalTransfer({
        deps: harness.deps,
        agentKey: "default",
        privateKeyHex: PRIVATE_KEY,
        network: "base",
        token: "eth",
        amount: "1",
        to: TO,
        idempotencyKey,
      });

      await vi.waitFor(() => {
        expect(mocks.sendRawTransactionMock).toHaveBeenCalledTimes(1);
      });

      const second = executeLocalTransfer({
        deps: harness.deps,
        agentKey: "default",
        privateKeyHex: PRIVATE_KEY,
        network: "base",
        token: "eth",
        amount: "1",
        to: TO,
        idempotencyKey,
      });

      await flushMicrotasks();
      await vi.advanceTimersByTimeAsync(60_000);

      await expect(second).resolves.toMatchObject({
        ok: true,
        kind: "transfer",
        replayed: true,
        transactionHash: "0xlateprepared",
      });
      expect(readPersistedReceipt(harness, "default", idempotencyKey)).toMatchObject({
        status: "confirmed",
        txHash: "0xlateprepared",
      });

      suspendOwnerOneHeartbeat = false;
      firstSubmit.resolve("0xlateprepared");
      await flushMicrotasks();

      await expect(first).resolves.toMatchObject({
        ok: true,
        kind: "transfer",
        replayed: true,
        transactionHash: "0xlateprepared",
      });
      expect(mocks.prepareTransactionRequestMock).toHaveBeenCalledTimes(1);
      expect(mocks.signTransactionMock).toHaveBeenCalledTimes(1);
      expect(mocks.sendRawTransactionMock).toHaveBeenCalledTimes(2);
      expect(readPersistedReceipt(harness, "default", idempotencyKey)).toMatchObject({
        status: "confirmed",
        txHash: "0xlateprepared",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("replays a matching receipt that appears after the lock is acquired", async () => {
    const harness = createHarness();
    const idempotencyKey = "92929292-9292-4929-8929-929292929292";
    const lockFile = lockPath("default", idempotencyKey);
    const receiptFile = receiptPath("default", idempotencyKey);
    const originalWriteFileSync = harness.deps.fs.writeFileSync;

    harness.deps.fs.writeFileSync = (file, data, options) => {
      originalWriteFileSync(file, data, options as never);
      const flag =
        typeof options === "object" && options !== null
          ? (options as { flag?: string }).flag
          : undefined;
      if (file === lockFile && flag === "wx") {
        harness.files.set(
          receiptFile,
          JSON.stringify(
            {
              version: 1,
              kind: "transfer",
              network: "base",
              to: TO.toLowerCase(),
              token: "eth",
              amount: "1",
              decimals: null,
              valueEth: null,
              data: null,
              status: "confirmed",
              txHash: "0xafter-lock",
              savedAt: new Date().toISOString(),
            },
            null,
            2
          )
        );
      }
    };

    const result = await executeLocalTransfer({
      deps: harness.deps,
      agentKey: "default",
      privateKeyHex: PRIVATE_KEY,
      network: "base",
      token: "eth",
      amount: "1",
      to: TO,
      idempotencyKey,
    });

    expect(result).toMatchObject({
      ok: true,
      kind: "transfer",
      replayed: true,
      transactionHash: "0xafter-lock",
    });
    expect(mocks.prepareTransactionRequestMock).not.toHaveBeenCalled();
    expect(mocks.signTransactionMock).not.toHaveBeenCalled();
    expect(mocks.sendRawTransactionMock).not.toHaveBeenCalled();
    expect(harness.files.has(lockFile)).toBe(false);
  });

  it("executes generic tx calls and handles reverts", async () => {
    const harness = createHarness();

    setPreparedTransaction("0xtx1");
    mocks.sendRawTransactionMock.mockResolvedValue("0xtx1");
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

    setPreparedTransaction("0xtx2");
    mocks.sendRawTransactionMock.mockResolvedValue("0xtx2");
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

  it("rejects negative generic tx values before preparing a transaction", async () => {
    const harness = createHarness();

    await expect(
      executeLocalTx({
        deps: harness.deps,
        agentKey: "default",
        privateKeyHex: PRIVATE_KEY,
        network: "base",
        to: TO,
        valueEth: "-1",
        data: "0xdeadbeef",
        idempotencyKey: "91919191-9191-4919-8919-919191919191",
      })
    ).rejects.toThrow("--value must be greater than or equal to 0");

    expect(mocks.prepareTransactionRequestMock).not.toHaveBeenCalled();
    expect(mocks.signTransactionMock).not.toHaveBeenCalled();
    expect(mocks.sendRawTransactionMock).not.toHaveBeenCalled();
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
