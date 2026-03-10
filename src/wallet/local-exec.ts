import path from "node:path";
import {
  type Address,
  type Hex,
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  erc20Abi,
  formatEther,
  http,
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
  type CliWalletSendToken,
} from "@cobuild/wire";
import type { CliDeps } from "../types.js";
import type { HexString } from "../farcaster/types.js";
import { normalizeEvmAddress } from "../commands/shared.js";

type LocalExecKind = "transfer" | "tx";

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
  txHash: Hex;
  savedAt: string;
};

type LocalExecClientDeps = Pick<CliDeps, "fetch" | "env">;
type LocalExecFsDeps = Pick<CliDeps, "fs" | "homedir">;

const LOCAL_EXEC_RECEIPT_VERSION = 1;

const BASESCAN_BY_NETWORK: Record<"base", string> = {
  base: "https://basescan.org",
};

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

function isLocalExecReceipt(value: unknown): value is LocalExecReceipt {
  const record = asRecord(value);
  if (!record) return false;
  const tokenValid = typeof record.token === "string" || record.token === null;
  const amountValid = typeof record.amount === "string" || record.amount === null;
  const decimalsValid = typeof record.decimals === "number" || record.decimals === null;
  const valueEthValid = typeof record.valueEth === "string" || record.valueEth === null;
  const dataValid = typeof record.data === "string" || record.data === null;
  return (
    record.version === LOCAL_EXEC_RECEIPT_VERSION &&
    (record.kind === "transfer" || record.kind === "tx") &&
    record.network === "base" &&
    typeof record.to === "string" &&
    tokenValid &&
    amountValid &&
    decimalsValid &&
    valueEthValid &&
    dataValid &&
    typeof record.txHash === "string" &&
    typeof record.savedAt === "string"
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

function writeLocalExecReceipt(params: {
  deps: Pick<CliDeps, "fs">;
  receiptPath: string;
  receipt: LocalExecReceipt;
}): void {
  const directory = path.dirname(params.receiptPath);
  params.deps.fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  params.deps.fs.writeFileSync(params.receiptPath, JSON.stringify(params.receipt, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  params.deps.fs.chmodSync?.(params.receiptPath, 0o600);
}

function assertSameReceiptIntent(params: {
  receipt: LocalExecReceipt;
  expected: Omit<LocalExecReceipt, "version" | "txHash" | "savedAt">;
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

async function sendAndWait(params: {
  deps: LocalExecClientDeps;
  privateKeyHex: HexString;
  network: CliWalletNetwork;
  to: Address;
  valueWei: bigint;
  data?: Hex;
}): Promise<Hex> {
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
  const publicClient = createPublicClient({
    chain,
    transport,
  });

  const txHash = await walletClient.sendTransaction({
    account,
    to: params.to,
    value: params.valueWei,
    ...(params.data ? { data: params.data } : {}),
    chain,
  });

  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
    confirmations: 1,
    timeout: 120_000,
  });
  if (receipt.status !== "success") {
    throw new Error(`Local wallet transaction reverted (tx: ${txHash}).`);
  }
  return txHash;
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
  const expectedReceipt = {
    kind: "transfer" as const,
    network,
    to: recipient,
    token: token,
    amount: params.amount,
    decimals: params.decimals ?? null,
    valueEth: null,
    data: null,
  };
  const existing = readLocalExecReceipt({
    deps: params.deps,
    receiptPath,
  });
  if (existing) {
    assertSameReceiptIntent({
      receipt: existing,
      expected: expectedReceipt,
    });
    return {
      ok: true,
      kind: "transfer",
      replayed: true,
      wallet: {
        address: account.address,
      },
      transactionHash: existing.txHash,
      explorerUrl: explorerUrl(network, existing.txHash),
    };
  }

  let txHash: Hex;
  if (token === "eth") {
    txHash = await sendAndWait({
      deps: params.deps,
      privateKeyHex: params.privateKeyHex,
      network,
      to: recipient,
      valueWei: amountAtomic,
    });
  } else {
    const tokenAddress: Address = token === "usdc" ? usdcContractForNetwork(network) : token;
    const transferData = encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [recipient, amountAtomic],
    });
    txHash = await sendAndWait({
      deps: params.deps,
      privateKeyHex: params.privateKeyHex,
      network,
      to: tokenAddress,
      valueWei: 0n,
      data: transferData,
    });
  }

  writeLocalExecReceipt({
    deps: params.deps,
    receiptPath,
    receipt: {
      version: LOCAL_EXEC_RECEIPT_VERSION,
      ...expectedReceipt,
      txHash,
      savedAt: new Date().toISOString(),
    },
  });

  return {
    ok: true,
    kind: "transfer",
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
  const expectedReceipt = {
    kind: "tx" as const,
    network,
    to,
    token: null,
    amount: null,
    decimals: null,
    valueEth: params.valueEth,
    data,
  };
  const existing = readLocalExecReceipt({
    deps: params.deps,
    receiptPath,
  });
  if (existing) {
    assertSameReceiptIntent({
      receipt: existing,
      expected: expectedReceipt,
    });
    return {
      ok: true,
      kind: "tx",
      replayed: true,
      wallet: {
        address: account.address,
      },
      transactionHash: existing.txHash,
      explorerUrl: explorerUrl(network, existing.txHash),
    };
  }

  const txHash = await sendAndWait({
    deps: params.deps,
    privateKeyHex: params.privateKeyHex,
    network,
    to,
    valueWei,
    data,
  });

  writeLocalExecReceipt({
    deps: params.deps,
    receiptPath,
    receipt: {
      version: LOCAL_EXEC_RECEIPT_VERSION,
      ...expectedReceipt,
      txHash,
      savedAt: new Date().toISOString(),
    },
  });

  return {
    ok: true,
    kind: "tx",
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
