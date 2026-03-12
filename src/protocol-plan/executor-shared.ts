import { readConfig } from "../config.js";
import { resolveLocalPayerPrivateKey } from "../farcaster/payer.js";
import { apiPost, asRecord } from "../transport.js";
import type { CliConfig, CliDeps } from "../types.js";
import { executeLocalTx } from "../wallet/local-exec.js";
import { requireStoredWalletConfig } from "../wallet/payer-config.js";
import {
  buildIdempotencyHeaders,
  resolveAgentKey,
  resolveExecIdempotencyKey,
  resolveNetwork,
} from "../commands/shared.js";
import { deriveProtocolPlanStepIdempotencyKey } from "./idempotency.js";
import { formatProtocolPlanStepLabel } from "./labels.js";
import type {
  ProtocolExecutionPlanLike,
  ProtocolPlanExecutionOutput,
  ProtocolPlanStepLike,
  ProtocolPlanStepOutput,
  ProtocolPlanStepRequest,
  RawTxProtocolPlanStepRequest,
} from "./types.js";
import { buildProtocolPlanWarnings, DRY_RUN_ONLY_WARNING } from "./warnings.js";

export type RawTxPlanLike<TAction extends string = string> = ProtocolExecutionPlanLike<TAction>;

export type ResolvedProtocolPlanWalletContext =
  | {
      walletMode: "hosted";
    }
  | {
      walletMode: "local";
      privateKeyHex: ReturnType<typeof resolveLocalPayerPrivateKey>;
    };

export interface RawTxPlanExecutionResult<TPlan extends RawTxPlanLike> {
  plan: TPlan;
  agentKey: string;
  walletMode: "hosted" | "local";
  network: string;
  idempotencyKey: string;
  planWarnings: string[];
  steps: ProtocolPlanStepOutput[];
  dryRun: boolean;
}

export function resolveStoredProtocolPlanWalletContext(params: {
  deps: Pick<CliDeps, "fs" | "homedir" | "env">;
  currentConfig: CliConfig;
  agentKey: string;
}): ResolvedProtocolPlanWalletContext {
  const walletConfig = requireStoredWalletConfig({
    deps: params.deps,
    agentKey: params.agentKey,
  });

  if (walletConfig.mode === "local") {
    return {
      walletMode: "local",
      privateKeyHex: resolveLocalPayerPrivateKey({
        deps: params.deps,
        currentConfig: params.currentConfig,
        payerConfig: walletConfig,
      }),
    };
  }

  return {
    walletMode: "hosted",
  };
}

export function buildRawTxProtocolPlanStepRequest(params: {
  network: string;
  agentKey: string;
  step: ProtocolPlanStepLike;
}): RawTxProtocolPlanStepRequest {
  return {
    kind: "tx",
    network: params.network,
    agentKey: params.agentKey,
    to: params.step.transaction.to,
    data: params.step.transaction.data,
    valueEth: params.step.transaction.valueEth,
  };
}

export function buildProtocolPlanStepOutputBase(params: {
  step: ProtocolPlanStepLike;
  stepNumber: number;
  stepCount: number;
  idempotencyKey: string;
  executionTarget: "hosted_api" | "local_wallet";
  request: ProtocolPlanStepRequest;
}): Omit<
  ProtocolPlanStepOutput,
  | "status"
  | "warnings"
  | "result"
  | "transactionHash"
  | "explorerUrl"
  | "replayed"
  | "receiptSummary"
  | "receiptDecodeError"
> {
  const common = {
    stepNumber: params.stepNumber,
    label: params.step.label,
    displayLabel: formatProtocolPlanStepLabel({
      stepNumber: params.stepNumber,
      stepCount: params.stepCount,
      label: params.step.label,
    }),
    kind: params.step.kind,
    idempotencyKey: params.idempotencyKey,
    executionTarget: params.executionTarget,
    transaction: params.step.transaction,
    request: params.request,
  };

  if (params.step.kind === "contract-call") {
    return {
      ...common,
      contract: params.step.contract,
      functionName: params.step.functionName,
    };
  }

  return {
    ...common,
    tokenAddress: params.step.tokenAddress,
    spenderAddress: params.step.spenderAddress,
    amount: params.step.amount,
  };
}

export function buildSucceededProtocolPlanStepOutput(params: {
  baseOutput: Omit<
    ProtocolPlanStepOutput,
    | "status"
    | "warnings"
    | "result"
    | "transactionHash"
    | "explorerUrl"
    | "replayed"
    | "receiptSummary"
    | "receiptDecodeError"
  >;
  result: Record<string, unknown>;
}): ProtocolPlanStepOutput {
  const stepOutput: ProtocolPlanStepOutput = {
    ...params.baseOutput,
    status: "succeeded",
    warnings: [],
    result: params.result,
  };

  if (typeof params.result.transactionHash === "string") {
    stepOutput.transactionHash = params.result.transactionHash;
  }
  if (typeof params.result.explorerUrl === "string") {
    stepOutput.explorerUrl = params.result.explorerUrl;
  }
  if (params.result.replayed === true) {
    stepOutput.replayed = true;
  }

  return stepOutput;
}

export function isHostedPendingStepResult(result: Record<string, unknown>): boolean {
  return result.pending === true || result.status === "pending";
}

export function buildRawTxProtocolPlanCommandOutput<TPlan extends RawTxPlanLike, TFamily extends string>(
  params: {
    family: TFamily;
    action: string;
    execution: RawTxPlanExecutionResult<TPlan>;
  }
): ProtocolPlanExecutionOutput & { family: TFamily } {
  return {
    ok: true,
    ...(params.execution.dryRun ? { dryRun: true as const } : {}),
    family: params.family,
    idempotencyKey: params.execution.idempotencyKey,
    agentKey: params.execution.agentKey,
    walletMode: params.execution.walletMode,
    action: params.action,
    network: params.execution.network,
    riskClass: params.execution.plan.riskClass,
    summary: params.execution.plan.summary,
    preconditions: [...params.execution.plan.preconditions],
    expectedEvents: [...(params.execution.plan.expectedEvents ?? [])],
    stepCount: params.execution.steps.length,
    executedStepCount: params.execution.dryRun ? 0 : params.execution.steps.length,
    replayedStepCount: params.execution.steps.filter((step) => step.replayed === true).length,
    warnings: params.execution.dryRun
      ? [...params.execution.planWarnings, DRY_RUN_ONLY_WARNING]
      : params.execution.planWarnings,
    steps: params.execution.steps,
  };
}

async function executeRawTxProtocolPlanStep(params: {
  deps: CliDeps;
  walletContext: ResolvedProtocolPlanWalletContext;
  agentKey: string;
  network: string;
  step: ProtocolPlanStepLike;
  idempotencyKey: string;
}): Promise<Record<string, unknown>> {
  const request = buildRawTxProtocolPlanStepRequest({
    network: params.network,
    agentKey: params.agentKey,
    step: params.step,
  });

  if (params.walletContext.walletMode === "local") {
    return await executeLocalTx({
      deps: params.deps,
      agentKey: params.agentKey,
      privateKeyHex: params.walletContext.privateKeyHex,
      network: params.network,
      to: request.to,
      valueEth: request.valueEth,
      data: request.data,
      idempotencyKey: params.idempotencyKey,
    });
  }

  return asRecord(
    await apiPost(params.deps, "/api/cli/exec", request, {
      headers: buildIdempotencyHeaders(params.idempotencyKey),
    })
  );
}

export async function executeRawTxProtocolPlan<TPlan extends RawTxPlanLike>(params: {
  deps: CliDeps;
  input: {
    agent?: string;
    dryRun?: boolean;
    idempotencyKey?: string;
  };
  plan: TPlan;
  formatStepFailureMessage(params: {
    displayLabel: string;
    stepIdempotencyKey: string;
    rootIdempotencyKey: string;
    cause: unknown;
  }): string;
  formatPendingMessage(params: {
    displayLabel: string;
    stepIdempotencyKey: string;
    rootIdempotencyKey: string;
    userOpHash: string;
  }): string;
  resolvePlanNetwork?: (plan: TPlan, deps: Pick<CliDeps, "env">) => string;
}): Promise<RawTxPlanExecutionResult<TPlan>> {
  const currentConfig = readConfig(params.deps);
  const agentKey = resolveAgentKey(params.input.agent, currentConfig.agent);
  const network =
    params.resolvePlanNetwork?.(params.plan, params.deps) ?? resolveNetwork(params.plan.network, params.deps);
  const idempotencyKey = resolveExecIdempotencyKey(params.input.idempotencyKey, params.deps);
  const walletContext = resolveStoredProtocolPlanWalletContext({
    deps: params.deps,
    currentConfig,
    agentKey,
  });
  const executionTarget = walletContext.walletMode === "hosted" ? "hosted_api" : "local_wallet";
  const planWarnings = buildProtocolPlanWarnings(params.plan);

  if (params.input.dryRun === true) {
    return {
      plan: params.plan,
      agentKey,
      walletMode: walletContext.walletMode,
      network,
      idempotencyKey,
      planWarnings,
      dryRun: true,
      steps: params.plan.steps.map((step, index) => {
        const stepNumber = index + 1;
        const stepIdempotencyKey = deriveProtocolPlanStepIdempotencyKey({
          rootIdempotencyKey: idempotencyKey,
          plan: params.plan,
          step,
          stepNumber,
        });
        const request = buildRawTxProtocolPlanStepRequest({
          network,
          agentKey,
          step,
        });

        return {
          ...buildProtocolPlanStepOutputBase({
            step,
            stepNumber,
            stepCount: params.plan.steps.length,
            idempotencyKey: stepIdempotencyKey,
            executionTarget,
            request,
          }),
          status: "dry-run" as const,
          warnings: [],
        };
      }),
    };
  }

  const steps: ProtocolPlanStepOutput[] = [];
  for (const [index, step] of params.plan.steps.entries()) {
    const stepNumber = index + 1;
    const stepIdempotencyKey = deriveProtocolPlanStepIdempotencyKey({
      rootIdempotencyKey: idempotencyKey,
      plan: params.plan,
      step,
      stepNumber,
    });
    const request = buildRawTxProtocolPlanStepRequest({
      network,
      agentKey,
      step,
    });
    const baseOutput = buildProtocolPlanStepOutputBase({
      step,
      stepNumber,
      stepCount: params.plan.steps.length,
      idempotencyKey: stepIdempotencyKey,
      executionTarget,
      request,
    });

    let result: Record<string, unknown>;
    try {
      result = await executeRawTxProtocolPlanStep({
        deps: params.deps,
        walletContext,
        agentKey,
        network,
        step,
        idempotencyKey: stepIdempotencyKey,
      });
    } catch (error) {
      throw new Error(
        params.formatStepFailureMessage({
          displayLabel: baseOutput.displayLabel,
          stepIdempotencyKey,
          rootIdempotencyKey: idempotencyKey,
          cause: error,
        })
      );
    }

    if (walletContext.walletMode === "hosted" && isHostedPendingStepResult(result)) {
      const userOpHash =
        typeof result.userOpHash === "string" && result.userOpHash.length > 0
          ? result.userOpHash
          : "unknown";
      throw new Error(
        params.formatPendingMessage({
          displayLabel: baseOutput.displayLabel,
          stepIdempotencyKey,
          rootIdempotencyKey: idempotencyKey,
          userOpHash,
        })
      );
    }

    steps.push(
      buildSucceededProtocolPlanStepOutput({
        baseOutput,
        result,
      })
    );
  }

  return {
    plan: params.plan,
    agentKey,
    walletMode: walletContext.walletMode,
    network,
    idempotencyKey,
    planWarnings,
    steps,
    dryRun: false,
  };
}
