import { createHash } from "node:crypto";
import { createPublicClient, formatEther, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import {
  buildRevnetBorrowPlanFromContext,
  buildRevnetCashOutIntent,
  buildRevnetPayIntent,
  defaultRpcUrlForNetwork,
  encodeWriteIntent,
  getRevnetBorrowContext,
  getRevnetCashOutContext,
  getRevnetPaymentContext,
  getRevnetPrepaidFeePercent,
  quoteRevnetCashOut,
  quoteRevnetPurchase,
  REVNET_SECONDS_PER_YEAR,
} from "@cobuild/wire";
import { readConfig } from "../config.js";
import { apiPost } from "../transport.js";
import type { CliDeps } from "../types.js";
import { fetchHostedPayerAddress, resolveLocalPayerPrivateKey } from "../farcaster/payer.js";
import { normalizeKeyedRemoteToolResponse } from "./remote-tool.js";
import {
  buildIdempotencyHeaders,
  normalizeEvmAddress,
  resolveAgentKey,
  resolveExecIdempotencyKey,
  resolveNetwork,
  throwWithIdempotencyKey,
  validateHexData,
  withIdempotencyKey,
} from "./shared.js";
import { executeCanonicalToolOnly } from "./tool-execution.js";
import { executeLocalTx } from "../wallet/local-exec.js";
import { executeWithConfiguredWallet, requireStoredWalletConfig } from "../wallet/payer-config.js";

const REVNET_PAY_USAGE =
  "Usage: cli revnet pay --amount <wei> [--project-id <n>] [--beneficiary <address>] [--min-returned-tokens <n>] [--memo <text>] [--metadata <hex>] [--network <network>] [--agent <key>] [--idempotency-key <key>] [--dry-run]";
const REVNET_CASH_OUT_USAGE =
  "Usage: cli revnet cash-out --cash-out-count <n> [--project-id <n>] [--beneficiary <address>] [--min-reclaim-amount <n>] [--preferred-base-token <address>] [--metadata <hex>] [--network <network>] [--agent <key>] [--idempotency-key <key>] [--dry-run]";
const REVNET_LOAN_USAGE =
  "Usage: cli revnet loan --collateral-count <n> --repay-years <n> [--project-id <n>] [--beneficiary <address>] [--min-borrow-amount <n>] [--preferred-base-token <address>] [--preferred-loan-token <address>] [--permission-mode <auto|force|skip>] [--network <network>] [--agent <key>] [--idempotency-key <key>] [--dry-run]";
const REVNET_ISSUANCE_TERMS_USAGE =
  "Usage: cli revnet issuance-terms [--project-id <n>]";
const REVNET_ISSUANCE_TERMS_CANONICAL_TOOL_NAMES = [
  "get-revnet-issuance-terms",
  "getRevnetIssuanceTerms",
  "revnetIssuanceTerms",
];

type JsonRecord = Record<string, unknown>;

type RevnetChildStepOutput = {
  key: string;
  label: string;
  idempotencyKey: string;
  request: JsonRecord;
  status: "dry-run" | "succeeded";
  result?: JsonRecord;
};

export interface RevnetPayCommandInput {
  amount?: string;
  projectId?: string;
  beneficiary?: string;
  minReturnedTokens?: string;
  memo?: string;
  metadata?: string;
  network?: string;
  agent?: string;
  idempotencyKey?: string;
  dryRun?: boolean;
}

export interface RevnetCashOutCommandInput {
  cashOutCount?: string;
  projectId?: string;
  beneficiary?: string;
  minReclaimAmount?: string;
  preferredBaseToken?: string;
  metadata?: string;
  network?: string;
  agent?: string;
  idempotencyKey?: string;
  dryRun?: boolean;
}

export interface RevnetLoanCommandInput {
  collateralCount?: string;
  repayYears?: string;
  projectId?: string;
  beneficiary?: string;
  minBorrowAmount?: string;
  preferredBaseToken?: string;
  preferredLoanToken?: string;
  permissionMode?: string;
  network?: string;
  agent?: string;
  idempotencyKey?: string;
  dryRun?: boolean;
}

export interface RevnetIssuanceTermsCommandInput {
  projectId?: string;
}

export interface RevnetWriteCommandOutput extends Record<string, unknown> {
  idempotencyKey: string;
}

export interface RevnetIssuanceTermsCommandOutput extends Record<string, unknown> {
  terms: unknown;
  ok?: boolean;
  untrusted: true;
  source: "remote_tool";
  warnings: string[];
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function serializeBigInts(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString(10);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => serializeBigInts(entry));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, serializeBigInts(entry)])
    );
  }
  return value;
}

function parseRequiredBigInt(value: string | undefined, label: string, usage: string): bigint {
  if (value === undefined) {
    throw new Error(usage);
  }
  return parseNonNegativeBigInt(value, label);
}

function parseOptionalBigInt(value: string | undefined, label: string): bigint | undefined {
  if (value === undefined) {
    return undefined;
  }
  return parseNonNegativeBigInt(value, label);
}

function parseNonNegativeBigInt(value: string, label: string): bigint {
  const trimmed = value.trim();
  if (!/^(0|[1-9]\d*)$/.test(trimmed)) {
    throw new Error(`${label} must be a non-negative integer string.`);
  }
  return BigInt(trimmed);
}

function parsePositiveNumber(value: string | undefined, label: string, usage: string): number {
  if (value === undefined) {
    throw new Error(usage);
  }
  const trimmed = value.trim();
  if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(trimmed)) {
    throw new Error(`${label} must be a positive decimal number.`);
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be greater than 0.`);
  }
  return parsed;
}

function parseProjectId(value: string | undefined): bigint | undefined {
  if (value === undefined) {
    return undefined;
  }
  return parseNonNegativeBigInt(value, "--project-id");
}

function parsePermissionMode(value: string | undefined): "auto" | "force" | "skip" | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "auto" || value === "force" || value === "skip") {
    return value;
  }
  throw new Error('--permission-mode must be one of "auto", "force", or "skip".');
}

function parseOptionalMetadataHex(value: string | undefined): Hex | undefined {
  if (value === undefined) {
    return undefined;
  }
  validateHexData(value, "--metadata");
  return value as Hex;
}

function toJsonNumberOrString(value: bigint): number | string {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) ? numeric : value.toString(10);
}

function resolveRpcUrlForNetwork(deps: Pick<CliDeps, "env">, network: string): string {
  if (network !== "base") {
    throw new Error(`Unsupported network "${network}". Only "base" is supported.`);
  }
  return deps.env?.COBUILD_CLI_BASE_RPC_URL?.trim() || defaultRpcUrlForNetwork("base");
}

function createBasePublicReadClient(
  deps: Pick<CliDeps, "env" | "fetch">,
  network: string
) {
  return createPublicClient({
    chain: base,
    transport: http(resolveRpcUrlForNetwork(deps, network), {
      fetchFn: deps.fetch as typeof fetch,
      timeout: 20_000,
      retryCount: 1,
    }),
  });
}

async function resolveExecutionWalletAddress(params: {
  deps: CliDeps;
  agentKey: string;
}): Promise<`0x${string}`> {
  const current = readConfig(params.deps);
  const walletConfig = requireStoredWalletConfig({
    deps: params.deps,
    agentKey: params.agentKey,
  });

  if (walletConfig.mode === "local") {
    const privateKeyHex = resolveLocalPayerPrivateKey({
      deps: params.deps,
      currentConfig: current,
      payerConfig: walletConfig,
    });
    return privateKeyToAccount(privateKeyHex).address;
  }

  if (walletConfig.payerAddress) {
    return normalizeEvmAddress(walletConfig.payerAddress, "stored hosted wallet address");
  }

  const payerAddress = await fetchHostedPayerAddress({
    deps: params.deps,
    agentKey: params.agentKey,
  });
  if (!payerAddress) {
    throw new Error(
      "Hosted wallet address is unavailable. Run `cli wallet status` or pass an explicit beneficiary after the wallet address is known."
    );
  }
  return normalizeEvmAddress(payerAddress, "hosted wallet address");
}

function formatUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

function deriveRevnetStepIdempotencyKey(params: {
  rootIdempotencyKey: string;
  key: string;
  encoded: {
    to: `0x${string}`;
    data: Hex;
    value: bigint;
  };
}): string {
  const seed = [
    "revnet-step",
    params.rootIdempotencyKey,
    params.key,
    params.encoded.to,
    params.encoded.data,
    params.encoded.value.toString(10),
  ].join("\n");
  const hash = createHash("sha256").update(seed).digest();
  const bytes = Uint8Array.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return formatUuid(bytes);
}

function buildRawTxRequestBody(params: {
  network: string;
  agentKey: string;
  to: `0x${string}`;
  data: Hex;
  value: bigint;
}): JsonRecord {
  return {
    kind: "tx",
    network: params.network,
    agentKey: params.agentKey,
    to: params.to,
    data: params.data,
    valueEth: formatEther(params.value),
  };
}

async function executeRawTxRequest(params: {
  deps: CliDeps;
  currentConfig: ReturnType<typeof readConfig>;
  agentKey: string;
  network: string;
  requestBody: JsonRecord;
  idempotencyKey: string;
}): Promise<JsonRecord> {
  const to = String(params.requestBody.to);
  const data = String(params.requestBody.data);
  const valueEth = String(params.requestBody.valueEth);

  return await executeWithConfiguredWallet({
    deps: params.deps,
    currentConfig: params.currentConfig,
    agentKey: params.agentKey,
    onLocal: async ({ privateKeyHex }) => {
      try {
        return (await executeLocalTx({
          deps: params.deps,
          agentKey: params.agentKey,
          privateKeyHex,
          network: params.network,
          to,
          valueEth,
          data,
          idempotencyKey: params.idempotencyKey,
        })) as JsonRecord;
      } catch (error) {
        throwWithIdempotencyKey(error, params.idempotencyKey);
      }
    },
    onHosted: async () => {
      try {
        return (await apiPost(params.deps, "/api/cli/exec", params.requestBody, {
          headers: buildIdempotencyHeaders(params.idempotencyKey),
        })) as JsonRecord;
      } catch (error) {
        throwWithIdempotencyKey(error, params.idempotencyKey);
      }
    },
  });
}

function attachSerializedContext<T extends RevnetWriteCommandOutput>(
  output: T,
  extras: Record<string, unknown>
): T {
  Object.assign(output, serializeBigInts(extras));
  return output;
}

export async function executeRevnetPayCommand(
  input: RevnetPayCommandInput,
  deps: CliDeps
): Promise<RevnetWriteCommandOutput> {
  const amount = parseRequiredBigInt(input.amount, "--amount", REVNET_PAY_USAGE);
  if (amount <= 0n) {
    throw new Error("--amount must be greater than 0.");
  }

  const current = readConfig(deps);
  const agentKey = resolveAgentKey(input.agent, current.agent);
  const network = resolveNetwork(input.network, deps);
  const projectId = parseProjectId(input.projectId);
  const walletAddress = await resolveExecutionWalletAddress({
    deps,
    agentKey,
  });
  const beneficiary =
    input.beneficiary !== undefined
      ? normalizeEvmAddress(input.beneficiary, "--beneficiary")
      : walletAddress;
  const minReturnedTokens = parseOptionalBigInt(input.minReturnedTokens, "--min-returned-tokens");
  const metadata = parseOptionalMetadataHex(input.metadata);
  const client = createBasePublicReadClient(deps, network);
  const context = await getRevnetPaymentContext(client, {
    ...(projectId !== undefined ? { projectId } : {}),
  });

  if (context.isPayPaused) {
    throw new Error("Revnet payments are currently paused.");
  }
  if (!context.terminalAddress) {
    throw new Error("No supported REV payment terminal is configured for this project.");
  }
  if (!context.supportsPayments) {
    throw new Error("The configured REV payment terminal does not support native payments.");
  }

  const quote = quoteRevnetPurchase({
    paymentAmount: amount,
    weight: context.ruleset.ruleset.weight,
    reservedPercent: context.ruleset.metadata.reservedPercent,
  });
  const intent = buildRevnetPayIntent({
    terminalAddress: context.terminalAddress,
    ...(projectId !== undefined ? { projectId } : {}),
    amount,
    beneficiary,
    ...(minReturnedTokens !== undefined ? { minReturnedTokens } : {}),
    ...(input.memo !== undefined ? { memo: input.memo } : {}),
    ...(metadata !== undefined ? { metadata } : {}),
  });
  const encoded = encodeWriteIntent(intent);
  const requestBody = buildRawTxRequestBody({
    network,
    agentKey,
    to: encoded.to,
    data: encoded.data,
    value: encoded.value,
  });
  const idempotencyKey = resolveExecIdempotencyKey(input.idempotencyKey, deps);

  if (input.dryRun === true) {
    return attachSerializedContext(
      {
        ok: true,
        dryRun: true,
        idempotencyKey,
        request: {
          method: "POST",
          path: "/api/cli/exec",
          body: requestBody,
        },
      } as RevnetWriteCommandOutput,
      {
        agentKey,
        network,
        walletAddress,
        beneficiary,
        projectId: projectId ?? context.projectId,
        paymentContext: context,
        quote,
      }
    );
  }

  const response = await executeRawTxRequest({
    deps,
    currentConfig: current,
    agentKey,
    network,
    requestBody,
    idempotencyKey,
  });
  return attachSerializedContext(
    withIdempotencyKey(idempotencyKey, response) as RevnetWriteCommandOutput,
    {
      agentKey,
      network,
      walletAddress,
      beneficiary,
      projectId: projectId ?? context.projectId,
      paymentContext: context,
      quote,
    }
  );
}

export async function executeRevnetCashOutCommand(
  input: RevnetCashOutCommandInput,
  deps: CliDeps
): Promise<RevnetWriteCommandOutput> {
  const cashOutCount = parseRequiredBigInt(
    input.cashOutCount,
    "--cash-out-count",
    REVNET_CASH_OUT_USAGE
  );
  if (cashOutCount <= 0n) {
    throw new Error("--cash-out-count must be greater than 0.");
  }

  const current = readConfig(deps);
  const agentKey = resolveAgentKey(input.agent, current.agent);
  const network = resolveNetwork(input.network, deps);
  const projectId = parseProjectId(input.projectId);
  const walletAddress = await resolveExecutionWalletAddress({
    deps,
    agentKey,
  });
  const beneficiary =
    input.beneficiary !== undefined
      ? normalizeEvmAddress(input.beneficiary, "--beneficiary")
      : walletAddress;
  const minReclaimAmount = parseOptionalBigInt(input.minReclaimAmount, "--min-reclaim-amount");
  const metadata = parseOptionalMetadataHex(input.metadata);
  const preferredBaseToken =
    input.preferredBaseToken !== undefined
      ? normalizeEvmAddress(input.preferredBaseToken, "--preferred-base-token")
      : undefined;
  const client = createBasePublicReadClient(deps, network);
  const context = await getRevnetCashOutContext(client, {
    ...(projectId !== undefined ? { projectId } : {}),
    account: walletAddress,
    ...(preferredBaseToken !== undefined ? { preferredBaseToken } : {}),
  });

  if (!context.quoteTerminal || !context.quoteAccountingContext) {
    throw new Error("Cash out is not available for this project and token context.");
  }
  if (context.token.balance < cashOutCount) {
    throw new Error(
      `Requested cash out count exceeds wallet balance (${context.token.balance.toString()}).`
    );
  }

  const quote = await quoteRevnetCashOut(client, {
    ...(projectId !== undefined ? { projectId } : {}),
    rawCashOutCount: cashOutCount,
    terminal: context.quoteTerminal,
    accountingContext: context.quoteAccountingContext,
  });
  const intent = buildRevnetCashOutIntent({
    terminalAddress: context.quoteTerminal,
    holder: walletAddress,
    ...(projectId !== undefined ? { projectId } : {}),
    cashOutCount,
    tokenToReclaim: context.quoteAccountingContext.token,
    ...(minReclaimAmount !== undefined ? { minTokensReclaimed: minReclaimAmount } : {}),
    beneficiary,
    ...(metadata !== undefined ? { metadata } : {}),
  });
  const encoded = encodeWriteIntent(intent);
  const requestBody = buildRawTxRequestBody({
    network,
    agentKey,
    to: encoded.to,
    data: encoded.data,
    value: encoded.value,
  });
  const idempotencyKey = resolveExecIdempotencyKey(input.idempotencyKey, deps);

  if (input.dryRun === true) {
    return attachSerializedContext(
      {
        ok: true,
        dryRun: true,
        idempotencyKey,
        request: {
          method: "POST",
          path: "/api/cli/exec",
          body: requestBody,
        },
      } as RevnetWriteCommandOutput,
      {
        agentKey,
        network,
        walletAddress,
        beneficiary,
        projectId: projectId ?? context.projectId,
        cashOutContext: context,
        quote,
      }
    );
  }

  const response = await executeRawTxRequest({
    deps,
    currentConfig: current,
    agentKey,
    network,
    requestBody,
    idempotencyKey,
  });
  return attachSerializedContext(
    withIdempotencyKey(idempotencyKey, response) as RevnetWriteCommandOutput,
    {
      agentKey,
      network,
      walletAddress,
      beneficiary,
      projectId: projectId ?? context.projectId,
      cashOutContext: context,
      quote,
    }
  );
}

export async function executeRevnetLoanCommand(
  input: RevnetLoanCommandInput,
  deps: CliDeps
): Promise<RevnetWriteCommandOutput> {
  const collateralCount = parseRequiredBigInt(
    input.collateralCount,
    "--collateral-count",
    REVNET_LOAN_USAGE
  );
  if (collateralCount <= 0n) {
    throw new Error("--collateral-count must be greater than 0.");
  }

  const repayYears = parsePositiveNumber(input.repayYears, "--repay-years", REVNET_LOAN_USAGE);
  const permissionMode = parsePermissionMode(input.permissionMode);
  const current = readConfig(deps);
  const agentKey = resolveAgentKey(input.agent, current.agent);
  const network = resolveNetwork(input.network, deps);
  const projectId = parseProjectId(input.projectId);
  const walletAddress = await resolveExecutionWalletAddress({
    deps,
    agentKey,
  });
  const beneficiary =
    input.beneficiary !== undefined
      ? normalizeEvmAddress(input.beneficiary, "--beneficiary")
      : walletAddress;
  const minBorrowAmount = parseOptionalBigInt(input.minBorrowAmount, "--min-borrow-amount");
  const preferredBaseToken =
    input.preferredBaseToken !== undefined
      ? normalizeEvmAddress(input.preferredBaseToken, "--preferred-base-token")
      : undefined;
  const preferredLoanToken =
    input.preferredLoanToken !== undefined
      ? normalizeEvmAddress(input.preferredLoanToken, "--preferred-loan-token")
      : undefined;
  const client = createBasePublicReadClient(deps, network);
  const context = await getRevnetBorrowContext(client, {
    ...(projectId !== undefined ? { projectId } : {}),
    account: walletAddress,
    collateralCount,
    ...(preferredBaseToken !== undefined ? { preferredBaseToken } : {}),
    ...(preferredLoanToken !== undefined ? { preferredLoanToken } : {}),
  });

  if (context.token.balance < collateralCount) {
    throw new Error(
      `Requested collateral count exceeds wallet balance (${context.token.balance.toString()}).`
    );
  }
  if (!context.selectedLoanSource || !context.borrowableContext || context.borrowableAmount === null) {
    throw new Error("Loan is not available for this revnet and wallet position.");
  }
  if (context.borrowableAmount <= 0n) {
    throw new Error("Borrowable amount is zero for the requested collateral count.");
  }

  const liquidationYears =
    Number(context.feeConfig.liquidationDurationSeconds) / REVNET_SECONDS_PER_YEAR;
  const prepaidFeePercent = getRevnetPrepaidFeePercent({
    repayYears,
    minPrepaidFeePercent: context.feeConfig.minPrepaidFeePercent,
    maxPrepaidFeePercent: context.feeConfig.maxPrepaidFeePercent,
    liquidationYears,
  });
  const plan = buildRevnetBorrowPlanFromContext(context, {
    prepaidFeePercent,
    beneficiary,
    ...(minBorrowAmount !== undefined ? { minBorrowAmount } : {}),
    ...(permissionMode !== undefined ? { permissionMode } : {}),
  });
  const idempotencyKey = resolveExecIdempotencyKey(input.idempotencyKey, deps);
  const steps: RevnetChildStepOutput[] = [];

  for (const step of plan.steps) {
    const encoded = encodeWriteIntent(step.intent as Parameters<typeof encodeWriteIntent>[0]);
    const requestBody = buildRawTxRequestBody({
      network,
      agentKey,
      to: encoded.to,
      data: encoded.data,
      value: encoded.value,
    });
    const childIdempotencyKey = deriveRevnetStepIdempotencyKey({
      rootIdempotencyKey: idempotencyKey,
      key: step.key,
      encoded,
    });

    if (input.dryRun === true) {
      steps.push({
        key: step.key,
        label: step.label,
        idempotencyKey: childIdempotencyKey,
        request: requestBody,
        status: "dry-run",
      });
      continue;
    }

    const response = await executeRawTxRequest({
      deps,
      currentConfig: current,
      agentKey,
      network,
      requestBody,
      idempotencyKey: childIdempotencyKey,
    });
    steps.push({
      key: step.key,
      label: step.label,
      idempotencyKey: childIdempotencyKey,
      request: requestBody,
      status: "succeeded",
      result: response,
    });
  }

  return attachSerializedContext(
    {
      ok: true,
      ...(input.dryRun === true ? { dryRun: true as const } : {}),
      idempotencyKey,
    } as RevnetWriteCommandOutput,
    {
      agentKey,
      network,
      walletAddress,
      beneficiary,
      projectId: projectId ?? context.projectId,
      repayYears,
      prepaidFeePercent,
      liquidationYears,
      permissionRequired: plan.permissionRequired,
      preconditions: [...plan.preconditions],
      quote: plan.quote,
      borrowContext: context,
      stepCount: steps.length,
      executedStepCount: input.dryRun === true ? 0 : steps.length,
      replayedStepCount:
        input.dryRun === true
          ? 0
          : steps.filter((step) => isRecord(step.result) && step.result.replayed === true).length,
      steps,
    }
  );
}

export async function executeRevnetIssuanceTermsCommand(
  input: RevnetIssuanceTermsCommandInput,
  deps: CliDeps
): Promise<RevnetIssuanceTermsCommandOutput> {
  const projectId = parseProjectId(input.projectId);
  const response = await executeCanonicalToolOnly(deps, {
    canonicalToolNames: REVNET_ISSUANCE_TERMS_CANONICAL_TOOL_NAMES,
    input: {
      ...(projectId !== undefined ? { projectId: toJsonNumberOrString(projectId) } : {}),
    },
  });

  return normalizeKeyedRemoteToolResponse(response, "terms") as RevnetIssuanceTermsCommandOutput;
}
