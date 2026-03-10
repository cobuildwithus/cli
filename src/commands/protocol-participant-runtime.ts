import { createHash } from "node:crypto";
import { encodeFunctionData, erc20Abi, type Abi, type Hex } from "viem";
import { readConfig } from "../config.js";
import { apiPost, asRecord } from "../transport.js";
import type { CliDeps } from "../types.js";
import { executeLocalTx } from "../wallet/local-exec.js";
import { executeWithConfiguredWallet } from "../wallet/payer-config.js";
import {
  formatProtocolPlanResumeHint,
  formatProtocolPlanStepLabel,
} from "../protocol-plan/labels.js";
import {
  buildIdempotencyHeaders,
  normalizeEvmAddress,
  resolveAgentKey,
  resolveExecIdempotencyKey,
  resolveNetwork,
  throwWithIdempotencyKey,
} from "./shared.js";

export type ParticipantActionFamily = "tcr" | "vote" | "stake" | "premium";
export type ParticipantRiskClass = "governance" | "stake" | "claim";
export type ParticipantApprovalMode = "auto" | "force" | "skip";
export type BigintLike = string | number | bigint;

export interface ParticipantProtocolTransaction {
  to: string;
  data: Hex;
  valueEth: "0";
}

export interface ParticipantApprovalStep {
  kind: "erc20-approval";
  label: string;
  tokenAddress: string;
  spenderAddress: string;
  amount: string;
  transaction: ParticipantProtocolTransaction;
}

export interface ParticipantContractCallStep {
  kind: "contract-call";
  label: string;
  contract: string;
  functionName: string;
  transaction: ParticipantProtocolTransaction;
}

export type ParticipantPlanStep = ParticipantApprovalStep | ParticipantContractCallStep;

export interface ParticipantExecutionPlan {
  family: ParticipantActionFamily;
  action: string;
  riskClass: ParticipantRiskClass;
  summary: string;
  preconditions: readonly string[];
  steps: readonly ParticipantPlanStep[];
  expectedEvents?: readonly string[];
  network?: string;
}

export interface ParticipantPlanCommandInput {
  agent?: string;
  dryRun?: boolean;
  idempotencyKey?: string;
  network?: string;
}

export interface ParticipantPlanStepResult extends Record<string, unknown> {
  index: number;
  kind: ParticipantPlanStep["kind"];
  label: string;
  idempotencyKey: string;
  request: {
    method: "POST";
    path: "/api/cli/exec";
    body: {
      kind: "tx";
      network: string;
      agentKey: string;
      to: string;
      data: Hex;
      valueEth: "0";
    };
  };
  response?: Record<string, unknown>;
}

export interface ParticipantPlanCommandOutput extends Record<string, unknown> {
  network: string;
  family: ParticipantActionFamily;
  action: string;
  riskClass: ParticipantRiskClass;
  summary: string;
  preconditions: string[];
  steps: ParticipantPlanStepResult[];
  idempotencyKey: string;
  ok?: boolean;
  dryRun?: boolean;
  agentKey?: string;
  expectedEvents?: string[];
  executedStepCount?: number;
}

class HostedExecutionPendingError extends Error {}

function isHostedPendingResponse(response: Record<string, unknown>): boolean {
  return response.pending === true || response.status === "pending";
}

function formatHostedPendingMessage(params: {
  step: ParticipantPlanStepResult;
  stepCount: number;
  rootIdempotencyKey: string;
  response: Record<string, unknown>;
}): string {
  const displayLabel = formatProtocolPlanStepLabel({
    stepNumber: params.step.index,
    stepCount: params.stepCount,
    label: params.step.label,
  });
  const userOpHash =
    typeof params.response.userOpHash === "string" && params.response.userOpHash.length > 0
      ? params.response.userOpHash
      : "unknown";

  return `${displayLabel} is still pending on the hosted wallet (step idempotency key: ${params.step.idempotencyKey}, root idempotency key: ${params.rootIdempotencyKey}, userOpHash: ${userOpHash}). ${formatProtocolPlanResumeHint(params.rootIdempotencyKey)}`;
}

function normalizeProtocolBigInt(value: BigintLike, label: string): bigint {
  if (typeof value === "bigint") {
    if (value < 0n) {
      throw new Error(`${label} must be a non-negative integer.`);
    }
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
      throw new Error(`${label} must be a non-negative integer.`);
    }
    return BigInt(value);
  }

  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return BigInt(normalized);
}

function normalizeOptionalProtocolBigInt(
  value: BigintLike | null | undefined,
  label: string
): bigint | null {
  if (value === null || value === undefined) {
    return null;
  }
  return normalizeProtocolBigInt(value, label);
}

export function buildParticipantContractCallStep(params: {
  contract: string;
  functionName: string;
  label: string;
  to: string;
  abi: Abi;
  args?: readonly unknown[];
}): ParticipantContractCallStep {
  return {
    kind: "contract-call",
    label: params.label,
    contract: params.contract,
    functionName: params.functionName,
    transaction: {
      to: normalizeEvmAddress(params.to, `${params.contract} address`),
      data: encodeFunctionData({
        abi: params.abi,
        functionName: params.functionName,
        ...(params.args ? { args: params.args } : {}),
      }),
      valueEth: "0",
    },
  };
}

export function buildParticipantApprovalStep(params: {
  label: string;
  tokenAddress: string;
  spenderAddress: string;
  amount: BigintLike;
}): ParticipantApprovalStep {
  const tokenAddress = normalizeEvmAddress(params.tokenAddress, "tokenAddress");
  const spenderAddress = normalizeEvmAddress(params.spenderAddress, "spenderAddress");
  const amount = normalizeProtocolBigInt(params.amount, "approvalAmount");

  return {
    kind: "erc20-approval",
    label: params.label,
    tokenAddress,
    spenderAddress,
    amount: amount.toString(),
    transaction: {
      to: tokenAddress,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [spenderAddress, amount],
      }),
      valueEth: "0",
    },
  };
}

export function buildParticipantApprovalPlan(params: {
  mode?: ParticipantApprovalMode;
  tokenAddress: string;
  spenderAddress: string;
  requiredAmount: BigintLike;
  currentAllowance?: BigintLike | null;
  approvalAmount?: BigintLike;
  tokenLabel: string;
  spenderLabel: string;
}): {
  approvalIncluded: boolean;
  preconditions: string[];
  steps: ParticipantPlanStep[];
} {
  const mode = params.mode ?? "auto";
  const requiredAmount = normalizeProtocolBigInt(params.requiredAmount, "requiredAmount");
  const currentAllowance = normalizeOptionalProtocolBigInt(
    params.currentAllowance,
    "currentAllowance"
  );
  const approvalAmount = normalizeProtocolBigInt(
    params.approvalAmount ?? requiredAmount,
    "approvalAmount"
  );

  if (mode === "skip") {
    return {
      approvalIncluded: false,
      preconditions: [
        `Ensure ${params.tokenLabel} allowance for ${params.spenderLabel} covers at least ${requiredAmount.toString()}.`,
      ],
      steps: [],
    };
  }

  if (mode === "auto") {
    if (currentAllowance === null) {
      return {
        approvalIncluded: false,
        preconditions: [
          `Ensure ${params.tokenLabel} allowance for ${params.spenderLabel} covers at least ${requiredAmount.toString()}.`,
        ],
        steps: [],
      };
    }

    if (currentAllowance >= requiredAmount) {
      return {
        approvalIncluded: false,
        preconditions: [],
        steps: [],
      };
    }
  }

  return {
    approvalIncluded: true,
    preconditions: [],
    steps: [
      buildParticipantApprovalStep({
        label: `Approve ${params.tokenLabel} for ${params.spenderLabel}`,
        tokenAddress: params.tokenAddress,
        spenderAddress: params.spenderAddress,
        amount: approvalAmount,
      }),
    ],
  };
}

function formatUuidFromBytes(bytes: Uint8Array): string {
  const buffer = Buffer.from(bytes);
  buffer[6] = (buffer[6]! & 0x0f) | 0x40;
  buffer[8] = (buffer[8]! & 0x3f) | 0x80;
  const hex = buffer.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function deriveParticipantStepIdempotencyKey(
  rootIdempotencyKey: string,
  stepIndex: number
): string {
  const digest = createHash("sha256")
    .update(`protocol-participant-step:${rootIdempotencyKey}:${stepIndex}`)
    .digest();
  return formatUuidFromBytes(digest.subarray(0, 16));
}

function buildStepRequestBody(params: {
  network: string;
  agentKey: string;
  step: ParticipantPlanStep;
}): ParticipantPlanStepResult["request"]["body"] {
  return {
    kind: "tx",
    network: params.network,
    agentKey: params.agentKey,
    to: params.step.transaction.to,
    data: params.step.transaction.data,
    valueEth: params.step.transaction.valueEth,
  };
}

export async function executeParticipantProtocolPlan(params: {
  plan: ParticipantExecutionPlan;
  input: ParticipantPlanCommandInput;
  deps: CliDeps;
}): Promise<ParticipantPlanCommandOutput> {
  const current = readConfig(params.deps);
  const agentKey = resolveAgentKey(params.input.agent, current.agent);
  const network = resolveNetwork(params.input.network ?? params.plan.network, params.deps);
  const idempotencyKey = resolveExecIdempotencyKey(params.input.idempotencyKey, params.deps);

  const steps = params.plan.steps.map((step, index) => {
    const childIdempotencyKey = deriveParticipantStepIdempotencyKey(idempotencyKey, index);
    return {
      index: index + 1,
      kind: step.kind,
      label: step.label,
      idempotencyKey: childIdempotencyKey,
      request: {
        method: "POST" as const,
        path: "/api/cli/exec" as const,
        body: buildStepRequestBody({
          network,
          agentKey,
          step,
        }),
      },
    };
  });

  if (params.input.dryRun === true) {
    return {
      ok: true,
      dryRun: true,
      idempotencyKey,
      agentKey,
      network,
      family: params.plan.family,
      action: params.plan.action,
      riskClass: params.plan.riskClass,
      summary: params.plan.summary,
      preconditions: [...params.plan.preconditions],
      ...(params.plan.expectedEvents ? { expectedEvents: [...params.plan.expectedEvents] } : {}),
      steps,
    } satisfies ParticipantPlanCommandOutput;
  }

  try {
    const stepResults = await executeWithConfiguredWallet({
      deps: params.deps,
      currentConfig: current,
      agentKey,
      onHosted: async () => {
        const results: ParticipantPlanStepResult[] = [];
        for (const step of steps) {
          const response = asRecord(
            await apiPost(params.deps, "/api/cli/exec", step.request.body, {
              headers: buildIdempotencyHeaders(step.idempotencyKey),
            })
          );
          results.push({
            ...step,
            response,
          });
          if (isHostedPendingResponse(response)) {
            throw new HostedExecutionPendingError(
              formatHostedPendingMessage({
                step,
                stepCount: steps.length,
                rootIdempotencyKey: idempotencyKey,
                response,
              })
            );
          }
        }
        return results;
      },
      onLocal: async ({ privateKeyHex }) => {
        const results: ParticipantPlanStepResult[] = [];
        for (const step of steps) {
          const response = await executeLocalTx({
            deps: params.deps,
            agentKey,
            privateKeyHex,
            network,
            to: step.request.body.to,
            valueEth: step.request.body.valueEth,
            data: step.request.body.data,
            idempotencyKey: step.idempotencyKey,
          });
          results.push({
            ...step,
            response: asRecord(response),
          });
        }
        return results;
      },
    });

    return {
      ok: true,
      idempotencyKey,
      agentKey,
      network,
      family: params.plan.family,
      action: params.plan.action,
      riskClass: params.plan.riskClass,
      summary: params.plan.summary,
      preconditions: [...params.plan.preconditions],
      ...(params.plan.expectedEvents ? { expectedEvents: [...params.plan.expectedEvents] } : {}),
      executedStepCount: stepResults.length,
      steps: stepResults,
    } satisfies ParticipantPlanCommandOutput;
  } catch (error) {
    if (error instanceof HostedExecutionPendingError) {
      throw error;
    }
    throwWithIdempotencyKey(error, idempotencyKey);
  }
}
