import path from "node:path";
import { randomUUID as nodeRandomUUID } from "node:crypto";
import {
  type Address,
  type Hex,
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  erc20Abi,
  formatEther,
  http,
  keccak256,
  parseEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import {
  defaultRpcUrlForNetwork,
  normalizeCliWalletNetwork,
  normalizeCliWalletSendToken,
  parseCliWalletSendAmountAtomic,
  usdcContractForNetwork,
  type CliWalletNetwork,
} from "@cobuild/wire";
import type { CliDeps } from "../types.js";
import type { HexString } from "../farcaster/types.js";
import { normalizeEvmAddress } from "../commands/shared.js";

type LocalExecKind = "transfer" | "tx";
type LocalExecReceiptStatus = "broadcast" | "confirmed" | "reverted";
type LocalExecLockState = "active" | "recovery";

type LocalExecReceipt = {
  version: 1;
  kind: LocalExecKind;
  network: CliWalletNetwork;
  to: Address;
  token: string | null;
  amount: string | null;
  decimals: number | null;
  valueEth: string | null;
  data: Hex | null;
  status?: LocalExecReceiptStatus;
  txHash: Hex;
  savedAt: string;
};

type LocalExecClientDeps = Pick<CliDeps, "fetch" | "env">;
type LocalExecFsDeps = Pick<CliDeps, "fs" | "homedir">;
type LocalExecLockDeps = Pick<CliDeps, "fs"> & Partial<Pick<CliDeps, "randomUUID">>;
type LocalExecPreparedTx = {
  txHash: Hex;
  serializedTransaction: Hex;
};
type LocalExecLockPointer = {
  version: 1;
  ownerId: string;
};
type LocalExecLockfile = {
  version: 1;
  ownerId: string;
  createdAt: string;
  heartbeatAt?: string;
  state?: LocalExecLockState;
  intent: LocalExecIntent;
  preparedTx?: LocalExecPreparedTx;
};
type LocalExecIntent = Omit<LocalExecReceipt, "version" | "status" | "txHash" | "savedAt">;
type ExclusiveWriteFileFn = (
  path: string,
  data: string,
  options: {
    encoding: BufferEncoding;
    mode?: number;
    flag?: string;
  }
) => void;

const LOCAL_EXEC_RECEIPT_VERSION = 1;
const LOCAL_EXEC_LOCKFILE_VERSION = 1;
const LOCAL_EXEC_LOCK_HEARTBEAT_MS = 5_000;
const LOCAL_EXEC_LOCK_POLL_MS = 25;
const LOCAL_EXEC_LOCK_STALE_MS = 45_000;

let localExecTempFileCounter = 0;

const BASESCAN_BY_NETWORK: Record<"base", string> = {
  base: "https://basescan.org",
};

class LocalExecLockOwnershipLostError extends Error {
  constructor() {
    super("Local wallet execution lock ownership was lost.");
  }
}

function normalizeBaseOnlyLocalExecNetwork(network: string): "base" {
  const normalized = normalizeCliWalletNetwork(network);
  if (normalized !== "base") {
    throw new Error(`Unsupported network "${network}". Only "base" is supported.`);
  }
  return normalized;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function resolveWalletExecReceiptPath(params: {
  deps: Pick<CliDeps, "homedir">;
  agentKey: string;
  idempotencyKey: string;
}): string {
  return path.join(
    params.deps.homedir(),
    ".cobuild-cli",
    "agents",
    params.agentKey,
    "wallet",
    "exec",
    `${params.idempotencyKey}.json`
  );
}

function resolveWalletExecLockPath(receiptPath: string): string {
  return `${receiptPath}.lock`;
}

function resolveWalletExecLockStatePath(lockPath: string, ownerId: string): string {
  return `${lockPath}.${ownerId}`;
}

function nowIsoTimestamp(): string {
  return new Date().toISOString();
}

function nextLocalExecOwnerId(deps: Partial<Pick<CliDeps, "randomUUID">>): string {
  return deps.randomUUID?.() ?? nodeRandomUUID();
}

function isLocalExecReceipt(value: unknown): value is LocalExecReceipt {
  const record = asRecord(value);
  if (!record) return false;
  return isLocalExecIntent(record) && isLocalExecReceiptTail(record);
}

function isLocalExecIntent(value: unknown): value is LocalExecIntent {
  const record = asRecord(value);
  if (!record) return false;
  const tokenValid = typeof record.token === "string" || record.token === null;
  const amountValid = typeof record.amount === "string" || record.amount === null;
  const decimalsValid = typeof record.decimals === "number" || record.decimals === null;
  const valueEthValid = typeof record.valueEth === "string" || record.valueEth === null;
  const dataValid = typeof record.data === "string" || record.data === null;
  return (
    (record.kind === "transfer" || record.kind === "tx") &&
    record.network === "base" &&
    typeof record.to === "string" &&
    tokenValid &&
    amountValid &&
    decimalsValid &&
    valueEthValid &&
    dataValid
  );
}

function isLocalExecReceiptTail(value: Record<string, unknown>): boolean {
  const statusValid =
    value.status === undefined ||
    value.status === "broadcast" ||
    value.status === "confirmed" ||
    value.status === "reverted";
  return (
    value.version === LOCAL_EXEC_RECEIPT_VERSION &&
    statusValid &&
    typeof value.txHash === "string" &&
    typeof value.savedAt === "string"
  );
}

function localExecReceiptStatus(receipt: LocalExecReceipt): LocalExecReceiptStatus {
  return receipt.status ?? "confirmed";
}

function isLocalExecLockPointer(value: unknown): value is LocalExecLockPointer {
  const record = asRecord(value);
  return (
    record?.version === LOCAL_EXEC_LOCKFILE_VERSION && typeof record.ownerId === "string"
  );
}

function isLocalExecLockfile(value: unknown): value is LocalExecLockfile {
  const record = asRecord(value);
  return (
    record?.version === LOCAL_EXEC_LOCKFILE_VERSION &&
    typeof record.ownerId === "string" &&
    typeof record.createdAt === "string" &&
    (record.heartbeatAt === undefined || typeof record.heartbeatAt === "string") &&
    (record.state === undefined || record.state === "active" || record.state === "recovery") &&
    isLocalExecIntent(record.intent) &&
    isLocalExecPreparedTx(record.preparedTx)
  );
}

function isLocalExecPreparedTx(value: unknown): value is LocalExecPreparedTx | undefined {
  if (value === undefined) {
    return true;
  }
  const record = asRecord(value);
  return (
    record !== null &&
    typeof record.txHash === "string" &&
    typeof record.serializedTransaction === "string"
  );
}

function localExecLockState(lockfile: LocalExecLockfile): LocalExecLockState {
  return lockfile.state ?? "active";
}

function sameLocalExecLockIntent(
  left: LocalExecIntent,
  right: LocalExecIntent
): boolean {
  return (
    left.kind === right.kind &&
    left.network === right.network &&
    left.to === right.to &&
    left.token === right.token &&
    left.amount === right.amount &&
    left.decimals === right.decimals &&
    left.valueEth === right.valueEth &&
    left.data === right.data
  );
}

function sameLocalExecPreparedTx(
  left: LocalExecPreparedTx | undefined,
  right: LocalExecPreparedTx | undefined
): boolean {
  if (!left || !right) {
    return left === right;
  }
  return (
    left.txHash === right.txHash &&
    left.serializedTransaction === right.serializedTransaction
  );
}

function sameLocalExecLockSnapshot(
  left: LocalExecLockfile,
  right: LocalExecLockfile
): boolean {
  return (
    left.version === right.version &&
    left.ownerId === right.ownerId &&
    left.createdAt === right.createdAt &&
    left.heartbeatAt === right.heartbeatAt &&
    localExecLockState(left) === localExecLockState(right) &&
    sameLocalExecLockIntent(left.intent, right.intent) &&
    sameLocalExecPreparedTx(left.preparedTx, right.preparedTx)
  );
}

function readLocalExecReceipt(params: {
  deps: Pick<CliDeps, "fs">;
  receiptPath: string;
}): LocalExecReceipt | null {
  if (!params.deps.fs.existsSync(params.receiptPath)) {
    return null;
  }

  const raw = params.deps.fs.readFileSync(params.receiptPath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Wallet local execution idempotency receipt contains invalid JSON.");
  }

  if (!isLocalExecReceipt(parsed)) {
    throw new Error(
      "Wallet local execution idempotency receipt has invalid shape. Delete it and retry with a new idempotency key."
    );
  }
  return parsed;
}

function readLocalExecLockfile(params: {
  deps: Pick<CliDeps, "fs">;
  lockPath: string;
}): LocalExecLockfile | null {
  if (!params.deps.fs.existsSync(params.lockPath)) {
    return null;
  }

  let pointerParsed: unknown;
  try {
    pointerParsed = JSON.parse(params.deps.fs.readFileSync(params.lockPath, "utf8"));
  } catch {
    return null;
  }

  if (!isLocalExecLockPointer(pointerParsed)) {
    return null;
  }

  return readLocalExecLockStateFile({
    deps: params.deps,
    lockPath: params.lockPath,
    ownerId: pointerParsed.ownerId,
  });
}

function readLocalExecLockPointer(params: {
  deps: Pick<CliDeps, "fs">;
  lockPath: string;
}): LocalExecLockPointer | null {
  if (!params.deps.fs.existsSync(params.lockPath)) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(params.deps.fs.readFileSync(params.lockPath, "utf8"));
  } catch {
    return null;
  }

  if (!isLocalExecLockPointer(parsed)) {
    return null;
  }
  return parsed;
}

function readLocalExecLockStateFile(params: {
  deps: Pick<CliDeps, "fs">;
  lockPath: string;
  ownerId: string;
}): LocalExecLockfile | null {
  const statePath = resolveWalletExecLockStatePath(params.lockPath, params.ownerId);
  if (!params.deps.fs.existsSync(statePath)) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(params.deps.fs.readFileSync(statePath, "utf8"));
  } catch {
    return null;
  }

  if (!isLocalExecLockfile(parsed) || parsed.ownerId !== params.ownerId) {
    return null;
  }
  return parsed;
}

function localExecLockfileAgeMs(lockfile: LocalExecLockfile): number {
  const lastHeartbeatAt =
    typeof lockfile.heartbeatAt === "string" ? lockfile.heartbeatAt : lockfile.createdAt;
  const lastHeartbeatMs = Date.parse(lastHeartbeatAt);
  if (Number.isNaN(lastHeartbeatMs)) {
    return Number.POSITIVE_INFINITY;
  }
  return Date.now() - lastHeartbeatMs;
}

function isFsErrorCode(error: unknown, code: string): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  return "code" in error && (error as { code?: unknown }).code === code;
}

function unlinkIfExists(params: {
  deps: Pick<CliDeps, "fs">;
  filePath: string;
}): void {
  if (!params.deps.fs.unlinkSync) {
    return;
  }

  try {
    params.deps.fs.unlinkSync(params.filePath);
  } catch (error) {
    if (!isFsErrorCode(error, "ENOENT")) {
      throw error;
    }
  }
}

function releaseLocalExecLock(params: {
  deps: Pick<CliDeps, "fs">;
  lockPath: string;
}): void {
  unlinkIfExists({
    deps: params.deps,
    filePath: params.lockPath,
  });
}

function releaseOwnedLocalExecLock(params: {
  deps: Pick<CliDeps, "fs">;
  lockPath: string;
  ownerId: string;
}): void {
  const currentPointer = readLocalExecLockPointer({
    deps: params.deps,
    lockPath: params.lockPath,
  });
  if (currentPointer?.ownerId === params.ownerId) {
    releaseLocalExecLock({
      deps: params.deps,
      lockPath: params.lockPath,
    });
  }
  unlinkIfExists({
    deps: params.deps,
    filePath: resolveWalletExecLockStatePath(params.lockPath, params.ownerId),
  });
}

function reapLocalExecLock(params: {
  deps: Pick<CliDeps, "fs">;
  lockPath: string;
  ownerId: string;
}): void {
  releaseOwnedLocalExecLock(params);
}

function nextLocalExecTempPath(filePath: string): string {
  localExecTempFileCounter += 1;
  return `${filePath}.${process.pid}.${Date.now()}.${localExecTempFileCounter}.tmp`;
}

function writeLocalExecFile(params: {
  deps: Pick<CliDeps, "fs">;
  filePath: string;
  payload: string;
  exclusive?: boolean;
}): void {
  params.deps.fs.mkdirSync(path.dirname(params.filePath), {
    recursive: true,
    mode: 0o700,
  });

  if (params.exclusive) {
    const writeExclusive = params.deps.fs.writeFileSync as unknown as ExclusiveWriteFileFn;
    writeExclusive(params.filePath, params.payload, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
  } else if (params.deps.fs.renameSync) {
    const tempPath = nextLocalExecTempPath(params.filePath);
    try {
      params.deps.fs.writeFileSync(tempPath, params.payload, {
        encoding: "utf8",
        mode: 0o600,
      });
      params.deps.fs.chmodSync?.(tempPath, 0o600);
      params.deps.fs.renameSync(tempPath, params.filePath);
    } catch (error) {
      unlinkIfExists({
        deps: params.deps,
        filePath: tempPath,
      });
      throw error;
    }
  } else {
    params.deps.fs.writeFileSync(params.filePath, params.payload, {
      encoding: "utf8",
      mode: 0o600,
    });
  }

  params.deps.fs.chmodSync?.(params.filePath, 0o600);
}

function writeLocalExecLockfile(params: {
  deps: Pick<CliDeps, "fs">;
  lockPath: string;
  lockfile: LocalExecLockfile;
  exclusive?: boolean;
}): void {
  writeLocalExecFile({
    deps: params.deps,
    filePath: resolveWalletExecLockStatePath(params.lockPath, params.lockfile.ownerId),
    payload: JSON.stringify(params.lockfile, null, 2),
    exclusive: params.exclusive,
  });
}

function writeLocalExecLockPointer(params: {
  deps: Pick<CliDeps, "fs">;
  lockPath: string;
  pointer: LocalExecLockPointer;
  exclusive?: boolean;
}): void {
  writeLocalExecFile({
    deps: params.deps,
    filePath: params.lockPath,
    payload: JSON.stringify(params.pointer, null, 2),
    exclusive: params.exclusive,
  });
}

function writeOwnedLocalExecLockfile(params: {
  deps: Pick<CliDeps, "fs">;
  lockPath: string;
  lockfile: LocalExecLockfile;
}): boolean {
  const currentLock = readLocalExecLockfile({
    deps: params.deps,
    lockPath: params.lockPath,
  });
  if (currentLock?.ownerId !== params.lockfile.ownerId) {
    return false;
  }
  writeLocalExecLockfile(params);
  return (
    readLocalExecLockfile({
      deps: params.deps,
      lockPath: params.lockPath,
    })?.ownerId === params.lockfile.ownerId
  );
}

function claimLocalExecLockPointer(params: {
  deps: Pick<CliDeps, "fs">;
  lockPath: string;
  ownerId: string;
  replaceLockfile?: LocalExecLockfile;
}): boolean {
  if (params.replaceLockfile === undefined) {
    writeLocalExecLockPointer({
      deps: params.deps,
      lockPath: params.lockPath,
      pointer: {
        version: LOCAL_EXEC_LOCKFILE_VERSION,
        ownerId: params.ownerId,
      },
      exclusive: true,
    });
    return true;
  }

  const currentLock = readLocalExecLockfile({
    deps: params.deps,
    lockPath: params.lockPath,
  });
  if (!currentLock || !sameLocalExecLockSnapshot(currentLock, params.replaceLockfile)) {
    return false;
  }
  writeLocalExecLockPointer({
    deps: params.deps,
    lockPath: params.lockPath,
    pointer: {
      version: LOCAL_EXEC_LOCKFILE_VERSION,
      ownerId: params.ownerId,
    },
  });
  const claimedPointer =
    readLocalExecLockPointer({
      deps: params.deps,
      lockPath: params.lockPath,
    })?.ownerId === params.ownerId;
  if (!claimedPointer) {
    return false;
  }

  const replacedLock = readLocalExecLockStateFile({
    deps: params.deps,
    lockPath: params.lockPath,
    ownerId: params.replaceLockfile.ownerId,
  });
  if (replacedLock && !sameLocalExecLockSnapshot(replacedLock, params.replaceLockfile)) {
    const currentPointer = readLocalExecLockPointer({
      deps: params.deps,
      lockPath: params.lockPath,
    });
    if (currentPointer?.ownerId === params.ownerId) {
      writeLocalExecLockPointer({
        deps: params.deps,
        lockPath: params.lockPath,
        pointer: {
          version: LOCAL_EXEC_LOCKFILE_VERSION,
          ownerId: params.replaceLockfile.ownerId,
        },
      });
    }
    return false;
  }
  return true;
}

function startLocalExecLockHeartbeat(params: {
  deps: Pick<CliDeps, "fs">;
  lockPath: string;
  currentLockfile: () => LocalExecLockfile;
  updateLockfile: (lockfile: LocalExecLockfile) => void;
}): () => void {
  const interval = setInterval(() => {
    try {
      const nextLockfile: LocalExecLockfile = {
        ...params.currentLockfile(),
        heartbeatAt: nowIsoTimestamp(),
      };
      if (
        !writeOwnedLocalExecLockfile({
          deps: params.deps,
          lockPath: params.lockPath,
          lockfile: nextLockfile,
        })
      ) {
        clearInterval(interval);
        return;
      }
      params.updateLockfile(nextLockfile);
    } catch {}
  }, LOCAL_EXEC_LOCK_HEARTBEAT_MS);
  interval.unref?.();
  return () => clearInterval(interval);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function createLocalExecLock(params: {
  deps: LocalExecLockDeps;
  lockPath: string;
  intent: LocalExecIntent;
  replaceLockfile?: LocalExecLockfile;
}): LocalExecLockfile | null {
  const createdAt = nowIsoTimestamp();
  const ownerId = nextLocalExecOwnerId(params.deps);
  const lockfile: LocalExecLockfile = {
    version: LOCAL_EXEC_LOCKFILE_VERSION,
    ownerId,
    createdAt,
    heartbeatAt: createdAt,
    state: "active",
    intent: params.intent,
  };
  writeLocalExecLockfile({
    deps: params.deps,
    lockPath: params.lockPath,
    lockfile,
    exclusive: true,
  });
  try {
    if (
      !claimLocalExecLockPointer({
        deps: params.deps,
        lockPath: params.lockPath,
        ownerId,
        replaceLockfile: params.replaceLockfile,
      })
    ) {
      unlinkIfExists({
        deps: params.deps,
        filePath: resolveWalletExecLockStatePath(params.lockPath, ownerId),
      });
      return null;
    }
  } catch (error) {
    unlinkIfExists({
      deps: params.deps,
      filePath: resolveWalletExecLockStatePath(params.lockPath, ownerId),
    });
    throw error;
  }
  return lockfile;
}

async function acquireLocalExecLock(params: {
  deps: LocalExecLockDeps;
  receiptPath: string;
  lockPath: string;
  intent: LocalExecIntent;
  replaceLockfile?: LocalExecLockfile;
}): Promise<
  | {
      notePreparedTx: (preparedTx: LocalExecPreparedTx) => void;
      preserveForRecovery: () => void;
      release: () => void;
    }
  | null
> {
  let unreadableLockObservedAtMs: number | null = null;

  while (true) {
    if (params.deps.fs.existsSync(params.receiptPath)) {
      return null;
    }

    try {
      const acquiredLockfile = createLocalExecLock({
        deps: params.deps,
        lockPath: params.lockPath,
        intent: params.intent,
        replaceLockfile: params.replaceLockfile,
      });
      if (!acquiredLockfile) {
        return null;
      }
      let currentLockfile: LocalExecLockfile = acquiredLockfile;
      const stopHeartbeat = startLocalExecLockHeartbeat({
        deps: params.deps,
        lockPath: params.lockPath,
        currentLockfile: () => currentLockfile,
        updateLockfile: (nextLockfile) => {
          currentLockfile = nextLockfile;
        },
      });
      let keepRecoveryLock = false;
      return {
        notePreparedTx: (preparedTx) => {
          currentLockfile = {
            ...currentLockfile,
            preparedTx,
            state: "active",
            heartbeatAt: nowIsoTimestamp(),
          };
          if (
            !writeOwnedLocalExecLockfile({
              deps: params.deps,
              lockPath: params.lockPath,
              lockfile: currentLockfile,
            })
          ) {
            throw new LocalExecLockOwnershipLostError();
          }
        },
        preserveForRecovery: () => {
          keepRecoveryLock = true;
          currentLockfile = {
            ...currentLockfile,
            state: "recovery",
          };
          try {
            writeOwnedLocalExecLockfile({
              deps: params.deps,
              lockPath: params.lockPath,
              lockfile: currentLockfile,
            });
          } catch {}
          stopHeartbeat();
        },
        release: () => {
          stopHeartbeat();
          if (keepRecoveryLock) {
            return;
          }
          releaseOwnedLocalExecLock({
            deps: params.deps,
            lockPath: params.lockPath,
            ownerId: currentLockfile.ownerId,
          });
        },
      };
    } catch (error) {
      if (!isFsErrorCode(error, "EEXIST")) {
        throw error;
      }
    }

    const currentLockfile = readLocalExecLockfile({
      deps: params.deps,
      lockPath: params.lockPath,
    });
    if (currentLockfile) {
      unreadableLockObservedAtMs = null;
      const lockAgeMs = localExecLockfileAgeMs(currentLockfile);
      if (lockAgeMs >= LOCAL_EXEC_LOCK_STALE_MS && params.deps.fs.unlinkSync) {
        if (currentLockfile.preparedTx) {
          return null;
        }
        return null;
      }
    } else if (params.deps.fs.existsSync(params.lockPath)) {
      unreadableLockObservedAtMs ??= Date.now();
      if (
        Date.now() - unreadableLockObservedAtMs >= LOCAL_EXEC_LOCK_STALE_MS &&
        params.deps.fs.unlinkSync
      ) {
        releaseLocalExecLock({
          deps: params.deps,
          lockPath: params.lockPath,
        });
        unreadableLockObservedAtMs = null;
        continue;
      }
    } else {
      unreadableLockObservedAtMs = null;
    }

    await sleep(LOCAL_EXEC_LOCK_POLL_MS);
  }
}

function writeLocalExecReceipt(params: {
  deps: Pick<CliDeps, "fs">;
  receiptPath: string;
  receipt: LocalExecReceipt;
  exclusive?: boolean;
}): void {
  writeLocalExecFile({
    deps: params.deps,
    filePath: params.receiptPath,
    payload: JSON.stringify(params.receipt, null, 2),
    exclusive: params.exclusive,
  });
}

function assertSameReceiptIntent(params: {
  receipt: LocalExecReceipt;
  expected: LocalExecIntent;
}): void {
  const { receipt, expected } = params;
  if (
    receipt.kind !== expected.kind ||
    receipt.network !== expected.network ||
    receipt.to !== expected.to ||
    receipt.token !== expected.token ||
    receipt.amount !== expected.amount ||
    receipt.decimals !== expected.decimals ||
    receipt.valueEth !== expected.valueEth ||
    receipt.data !== expected.data
  ) {
    throw new Error(
      "Idempotency key is already associated with a different local wallet request."
    );
  }
}

function resolveRpcUrl(network: CliWalletNetwork, deps: Pick<CliDeps, "env">): string {
  const env = deps.env ?? process.env;
  const envKey = "COBUILD_CLI_BASE_RPC_URL";
  const configured = env[envKey]?.trim();
  if (configured) {
    return configured;
  }
  return defaultRpcUrlForNetwork(network);
}

function resolveChain(network: CliWalletNetwork) {
  return base;
}

function explorerUrl(network: "base", txHash: Hex): string {
  return `${BASESCAN_BY_NETWORK[network]}/tx/${txHash}`;
}

async function sendTransaction(params: {
  deps: LocalExecClientDeps;
  privateKeyHex: HexString;
  network: CliWalletNetwork;
  to: Address;
  valueWei: bigint;
  data?: Hex;
}): Promise<LocalExecPreparedTx & { submit: () => Promise<void> }> {
  const chain = resolveChain(params.network);
  const rpcUrl = resolveRpcUrl(params.network, params.deps);
  const account = privateKeyToAccount(params.privateKeyHex);
  const transport = http(rpcUrl, {
    timeout: 30_000,
    retryCount: 2,
  });
  const walletClient = createWalletClient({
    account,
    chain,
    transport,
  });
  const request = await walletClient.prepareTransactionRequest({
    account,
    to: params.to,
    value: params.valueWei,
    ...(params.data ? { data: params.data } : {}),
    chain,
  });
  const serializedTransaction = (await account.signTransaction(
    request as Parameters<typeof account.signTransaction>[0],
    {
      serializer: chain.serializers?.transaction,
    }
  )) as Hex;
  const txHash = keccak256(serializedTransaction) as Hex;

  return {
    txHash,
    serializedTransaction,
    submit: async () => {
      await walletClient.sendRawTransaction({
        serializedTransaction,
      });
    },
  };
}

async function waitForTransactionOutcome(params: {
  deps: LocalExecClientDeps;
  network: CliWalletNetwork;
  txHash: Hex;
}): Promise<"confirmed" | "reverted"> {
  const chain = resolveChain(params.network);
  const rpcUrl = resolveRpcUrl(params.network, params.deps);
  const transport = http(rpcUrl, {
    timeout: 30_000,
    retryCount: 2,
  });
  const publicClient = createPublicClient({
    chain,
    transport,
  });

  const receipt = await publicClient.waitForTransactionReceipt({
    hash: params.txHash,
    confirmations: 1,
    timeout: 120_000,
  });
  return receipt.status === "success" ? "confirmed" : "reverted";
}

function buildLocalExecRevertError(txHash: Hex): Error {
  return new Error(`Local wallet transaction reverted (tx: ${txHash}).`);
}

async function settleLocalExecReceipt(params: {
  deps: LocalExecClientDeps & LocalExecFsDeps;
  receiptPath: string;
  receipt: LocalExecReceipt;
}): Promise<Hex> {
  const status = localExecReceiptStatus(params.receipt);
  if (status === "confirmed") {
    return params.receipt.txHash;
  }
  if (status === "reverted") {
    throw buildLocalExecRevertError(params.receipt.txHash);
  }

  const outcome = await waitForTransactionOutcome({
    deps: params.deps,
    network: params.receipt.network,
    txHash: params.receipt.txHash,
  });

  writeLocalExecReceipt({
    deps: params.deps,
    receiptPath: params.receiptPath,
    receipt: {
      ...params.receipt,
      status: outcome,
      savedAt: nowIsoTimestamp(),
    },
  });

  if (outcome === "reverted") {
    throw buildLocalExecRevertError(params.receipt.txHash);
  }
  return params.receipt.txHash;
}

function localExecLockfileToBroadcastReceipt(lockfile: LocalExecLockfile): LocalExecReceipt | null {
  if (!lockfile.preparedTx) {
    return null;
  }
  return {
    version: LOCAL_EXEC_RECEIPT_VERSION,
    ...lockfile.intent,
    status: "broadcast",
    txHash: lockfile.preparedTx.txHash,
    savedAt: lockfile.heartbeatAt ?? lockfile.createdAt,
  };
}

async function recoverPreparedLocalExec(params: {
  deps: LocalExecClientDeps & LocalExecFsDeps;
  network: CliWalletNetwork;
  receiptPath: string;
  preparedTx: LocalExecPreparedTx;
  receipt: LocalExecReceipt;
}): Promise<Hex> {
  const rpcUrl = resolveRpcUrl(params.network, params.deps);
  const transport = http(rpcUrl, {
    timeout: 30_000,
    retryCount: 2,
  });
  const publicClient = createPublicClient({
    chain: resolveChain(params.network),
    transport,
  });

  try {
    await publicClient.sendRawTransaction({
      serializedTransaction: params.preparedTx.serializedTransaction,
    });
  } catch {}

  return await settleLocalExecReceipt({
    deps: params.deps,
    receiptPath: params.receiptPath,
    receipt: params.receipt,
  });
}

async function executeLocalExecRequest(params: {
  deps: LocalExecClientDeps & LocalExecFsDeps;
  receiptPath: string;
  expectedReceipt: LocalExecIntent;
  prepare: () => Promise<LocalExecPreparedTx & { submit: () => Promise<void> }>;
}): Promise<{
  replayed: boolean;
  txHash: Hex;
}> {
  const lockPath = resolveWalletExecLockPath(params.receiptPath);

  while (true) {
    const existing = readLocalExecReceipt({
      deps: params.deps,
      receiptPath: params.receiptPath,
    });
    if (existing) {
      assertSameReceiptIntent({
        receipt: existing,
        expected: params.expectedReceipt,
      });
      return {
        replayed: true,
        txHash: await settleLocalExecReceipt({
          deps: params.deps,
          receiptPath: params.receiptPath,
          receipt: existing,
        }),
      };
    }

    const existingLock = readLocalExecLockfile({
      deps: params.deps,
      lockPath,
    });
    let releaseLock:
      | {
          notePreparedTx: (preparedTx: LocalExecPreparedTx) => void;
          preserveForRecovery: () => void;
          release: () => void;
        }
      | null = null;
    if (existingLock) {
      const staleLock = localExecLockfileAgeMs(existingLock) >= LOCAL_EXEC_LOCK_STALE_MS;
      assertSameReceiptIntent({
        receipt: {
          version: LOCAL_EXEC_RECEIPT_VERSION,
          ...existingLock.intent,
          txHash: existingLock.preparedTx?.txHash ?? ("0x" as Hex),
          savedAt: existingLock.heartbeatAt ?? existingLock.createdAt,
        },
        expected: params.expectedReceipt,
      });
      if (!existingLock.preparedTx && staleLock) {
        releaseLock = await acquireLocalExecLock({
          deps: params.deps,
          receiptPath: params.receiptPath,
          lockPath,
          intent: params.expectedReceipt,
          replaceLockfile: existingLock,
        });
        if (!releaseLock) {
          continue;
        }
      } else {
        const recoveryReceipt = localExecLockfileToBroadcastReceipt(existingLock);
        const preparedTx = existingLock.preparedTx;
        if (
          recoveryReceipt &&
          (localExecLockState(existingLock) === "recovery" || staleLock)
        ) {
          return {
            replayed: true,
            txHash: await recoverPreparedLocalExec({
              deps: params.deps,
              network: recoveryReceipt.network,
              receiptPath: params.receiptPath,
              preparedTx: preparedTx!,
              receipt: recoveryReceipt,
            }),
          };
        }
        await sleep(LOCAL_EXEC_LOCK_POLL_MS);
        continue;
      }
    } else {
      releaseLock = await acquireLocalExecLock({
        deps: params.deps,
        receiptPath: params.receiptPath,
        lockPath,
        intent: params.expectedReceipt,
      });
      if (!releaseLock) {
        continue;
      }
    }

    let released = false;
    try {
      const existingAfterLock = readLocalExecReceipt({
        deps: params.deps,
        receiptPath: params.receiptPath,
      });
      if (existingAfterLock) {
        releaseLock.release();
        released = true;
        continue;
      }

      const preparedTx = await params.prepare();
      try {
        releaseLock.notePreparedTx(preparedTx);
      } catch (error) {
        if (error instanceof LocalExecLockOwnershipLostError) {
          continue;
        }
        throw error;
      }
      const existingAfterPrepared = readLocalExecReceipt({
        deps: params.deps,
        receiptPath: params.receiptPath,
      });
      if (existingAfterPrepared) {
        releaseLock.release();
        released = true;
        continue;
      }
      try {
        await preparedTx.submit();
      } catch (error) {
        const existingAfterSubmitFailure = readLocalExecReceipt({
          deps: params.deps,
          receiptPath: params.receiptPath,
        });
        if (existingAfterSubmitFailure) {
          releaseLock.release();
          released = true;
          continue;
        }
        releaseLock.preserveForRecovery();
        throw error;
      }
      const existingAfterSubmit = readLocalExecReceipt({
        deps: params.deps,
        receiptPath: params.receiptPath,
      });
      if (existingAfterSubmit) {
        releaseLock.release();
        released = true;
        continue;
      }
      const broadcastReceipt: LocalExecReceipt = {
        version: LOCAL_EXEC_RECEIPT_VERSION,
        ...params.expectedReceipt,
        status: "broadcast",
        txHash: preparedTx.txHash,
        savedAt: nowIsoTimestamp(),
      };
      try {
        writeLocalExecReceipt({
          deps: params.deps,
          receiptPath: params.receiptPath,
          receipt: broadcastReceipt,
          exclusive: true,
        });
      } catch (error) {
        if (isFsErrorCode(error, "EEXIST")) {
          releaseLock.release();
          released = true;
          continue;
        }
        releaseLock.preserveForRecovery();
        throw error;
      }
      releaseLock.release();
      released = true;

      return {
        replayed: false,
        txHash: await settleLocalExecReceipt({
          deps: params.deps,
          receiptPath: params.receiptPath,
          receipt: broadcastReceipt,
        }),
      };
    } finally {
      if (!released) {
        releaseLock.release();
      }
    }
  }
}

export async function executeLocalTransfer(params: {
  deps: LocalExecClientDeps & LocalExecFsDeps;
  agentKey: string;
  privateKeyHex: HexString;
  network: string;
  to: string;
  token: string;
  amount: string;
  decimals?: number;
  idempotencyKey: string;
}): Promise<Record<string, unknown>> {
  const network = normalizeBaseOnlyLocalExecNetwork(params.network);
  const recipient = normalizeEvmAddress(params.to, "to");
  const token = normalizeCliWalletSendToken(params.token);
  const amountAtomic = parseCliWalletSendAmountAtomic({
    token,
    amount: params.amount,
    decimals: params.decimals,
  });
  if (amountAtomic <= 0n) {
    throw new Error("amount must be greater than 0");
  }

  const account = privateKeyToAccount(params.privateKeyHex);
  const receiptPath = resolveWalletExecReceiptPath({
    deps: params.deps,
    agentKey: params.agentKey,
    idempotencyKey: params.idempotencyKey,
  });
  const expectedReceipt: LocalExecIntent = {
    kind: "transfer",
    network,
    to: recipient,
    token,
    amount: params.amount,
    decimals: params.decimals ?? null,
    valueEth: null,
    data: null,
  };

  const { replayed, txHash } = await executeLocalExecRequest({
    deps: params.deps,
    receiptPath,
    expectedReceipt,
    prepare: async () => {
      if (token === "eth") {
        return await sendTransaction({
          deps: params.deps,
          privateKeyHex: params.privateKeyHex,
          network,
          to: recipient,
          valueWei: amountAtomic,
        });
      }

      const tokenAddress: Address = token === "usdc" ? usdcContractForNetwork(network) : token;
      const transferData = encodeFunctionData({
        abi: erc20Abi,
        functionName: "transfer",
        args: [recipient, amountAtomic],
      });
      return await sendTransaction({
        deps: params.deps,
        privateKeyHex: params.privateKeyHex,
        network,
        to: tokenAddress,
        valueWei: 0n,
        data: transferData,
      });
    },
  });

  return {
    ok: true,
    kind: "transfer",
    ...(replayed ? { replayed: true } : {}),
    wallet: {
      address: account.address,
    },
    transactionHash: txHash,
    explorerUrl: explorerUrl(network, txHash),
  };
}

export async function executeLocalTx(params: {
  deps: LocalExecClientDeps & LocalExecFsDeps;
  agentKey: string;
  privateKeyHex: HexString;
  network: string;
  to: string;
  valueEth: string;
  data: string;
  idempotencyKey: string;
}): Promise<Record<string, unknown>> {
  const network = normalizeBaseOnlyLocalExecNetwork(params.network);
  const to = normalizeEvmAddress(params.to, "--to");
  const valueWei = parseEther(params.valueEth);
  if (valueWei < 0n) {
    throw new Error("--value must be greater than or equal to 0");
  }
  const data = params.data as Hex;

  const account = privateKeyToAccount(params.privateKeyHex);
  const receiptPath = resolveWalletExecReceiptPath({
    deps: params.deps,
    agentKey: params.agentKey,
    idempotencyKey: params.idempotencyKey,
  });
  const expectedReceipt: LocalExecIntent = {
    kind: "tx",
    network,
    to,
    token: null,
    amount: null,
    decimals: null,
    valueEth: params.valueEth,
    data,
  };

  const { replayed, txHash } = await executeLocalExecRequest({
    deps: params.deps,
    receiptPath,
    expectedReceipt,
    prepare: async () =>
      await sendTransaction({
        deps: params.deps,
        privateKeyHex: params.privateKeyHex,
        network,
        to,
        valueWei,
        data,
      }),
  });

  return {
    ok: true,
    kind: "tx",
    ...(replayed ? { replayed: true } : {}),
    wallet: {
      address: account.address,
    },
    transactionHash: txHash,
    explorerUrl: explorerUrl(network, txHash),
  };
}

export function buildLocalWalletSummary(params: {
  agentKey: string;
  network: string;
  privateKeyHex: HexString;
}): Record<string, unknown> {
  const network = normalizeBaseOnlyLocalExecNetwork(params.network);
  const account = privateKeyToAccount(params.privateKeyHex);
  return {
    ok: true,
    wallet: {
      ownerAddress: account.address,
      agentKey: params.agentKey,
      address: account.address,
      defaultNetwork: network,
    },
  };
}

export function formatNeedsFundingResult(params: {
  priceWei: bigint;
  balanceWei: bigint;
  requiredWei: bigint;
}): {
  idGatewayPriceWei: string;
  idGatewayPriceEth: string;
  balanceWei: string;
  balanceEth: string;
  requiredWei: string;
  requiredEth: string;
} {
  return {
    idGatewayPriceWei: params.priceWei.toString(),
    idGatewayPriceEth: formatEther(params.priceWei),
    balanceWei: params.balanceWei.toString(),
    balanceEth: formatEther(params.balanceWei),
    requiredWei: params.requiredWei.toString(),
    requiredEth: formatEther(params.requiredWei),
  };
}
