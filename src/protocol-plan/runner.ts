import { readConfig } from "../config.js";
import { apiPost, asRecord } from "../transport.js";
import type { CliDeps } from "../types.js";
import {
  buildCliProtocolPlanRequest,
  buildCliProtocolStepRequest,
  type CliProtocolStepAction,
} from "@cobuild/wire";
import {
  buildIdempotencyHeaders,
  resolveAgentKey,
  resolveExecIdempotencyKey,
  resolveNetwork,
} from "../commands/shared.js";
import { executeLocalTx } from "../wallet/local-exec.js";
import { deriveProtocolPlanStepIdempotencyKey } from "./idempotency.js";
import {
  formatProtocolPlanResumeHint,
  formatProtocolPlanStepFailureMessage,
} from "./labels.js";
import {
  buildProtocolPlanStepOutputBase,
  buildRawTxProtocolPlanStepRequest,
  buildSucceededProtocolPlanStepOutput,
  isHostedPendingStepResult,
  resolveStoredProtocolPlanWalletContext,
  type ResolvedProtocolPlanWalletContext,
} from "./executor-shared.js";
import { tryDecodeProtocolPlanStepReceipt } from "./receipt.js";
import type {
  HostedProtocolPlanRequest,
  HostedProtocolPlanStepRequest,
  ProtocolExecutionPlanLike,
  ProtocolPlanExecutionInfo,
  ProtocolPlanExecutionOutput,
  ProtocolPlanExecutionRequest,
  ProtocolPlanStepLike,
  ProtocolPlanStepOutput,
  ProtocolPlanStepReceiptDecoder,
  ProtocolPlanStepRequest,
  ProtocolPlanWalletMode,
} from "./types.js";
import {
  buildProtocolPlanWarnings,
  collectProtocolPlanStepWarnings,
  DRY_RUN_ONLY_WARNING,
} from "./warnings.js";

function buildHostedProtocolPlanStepRequest(params: {
  network: string;
  agentKey: string;
  plan: ProtocolExecutionPlanLike<CliProtocolStepAction>;
  step: ProtocolPlanStepLike;
}): HostedProtocolPlanStepRequest {
  return {
    ...buildCliProtocolStepRequest({
      network: params.network,
      action: params.plan.action,
      riskClass: params.plan.riskClass,
      step: params.step,
    }),
    agentKey: params.agentKey,
  };
}

function buildHostedProtocolPlanRequest(params: {
  network: string;
  agentKey: string;
  plan: ProtocolExecutionPlanLike<CliProtocolStepAction>;
}): HostedProtocolPlanRequest {
  return {
    ...buildCliProtocolPlanRequest({
      network: params.network,
      action: params.plan.action,
      riskClass: params.plan.riskClass,
      steps: params.plan.steps,
    }),
    agentKey: params.agentKey,
  };
}

function buildHostedProtocolPlanExecutionRequest(params: {
  network: string;
  agentKey: string;
  plan: ProtocolExecutionPlanLike<CliProtocolStepAction>;
}): ProtocolPlanExecutionRequest {
  return {
    method: "POST",
    path: "/api/cli/exec",
    body: buildHostedProtocolPlanRequest(params),
  };
}

function buildProtocolPlanStepRequest(params: {
  walletMode: ProtocolPlanWalletMode;
  network: string;
  agentKey: string;
  plan: ProtocolExecutionPlanLike<CliProtocolStepAction>;
  step: ProtocolPlanStepLike;
}): ProtocolPlanStepRequest {
  if (params.walletMode === "local") {
    return buildRawTxProtocolPlanStepRequest({
      network: params.network,
      agentKey: params.agentKey,
      step: params.step,
    });
  }

  return buildHostedProtocolPlanStepRequest({
    network: params.network,
    agentKey: params.agentKey,
    plan: params.plan,
    step: params.step,
  });
}

function resolveProtocolPlanStepIdempotencyKey(params: {
  walletMode: ProtocolPlanWalletMode;
  rootIdempotencyKey: string;
  plan: ProtocolExecutionPlanLike;
  step: ProtocolPlanStepLike;
  stepNumber: number;
}): string {
  if (params.walletMode === "hosted") {
    return params.rootIdempotencyKey;
  }

  return deriveProtocolPlanStepIdempotencyKey({
    rootIdempotencyKey: params.rootIdempotencyKey,
    plan: params.plan,
    step: params.step,
    stepNumber: params.stepNumber,
  });
}

async function executeHostedProtocolPlan(params: {
  deps: Pick<CliDeps, "fetch" | "fs" | "homedir" | "env">;
  executionRequest: ProtocolPlanExecutionRequest;
  idempotencyKey: string;
}): Promise<Record<string, unknown>> {
  return asRecord(
    await apiPost(params.deps, params.executionRequest.path, params.executionRequest.body, {
      headers: buildIdempotencyHeaders(params.idempotencyKey),
    })
  );
}

async function executeLocalProtocolPlanStep(params: {
  deps: Pick<CliDeps, "fetch" | "fs" | "homedir" | "env">;
  walletContext: Extract<ResolvedProtocolPlanWalletContext, { walletMode: "local" }>;
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

function formatHostedProtocolPlanFailureMessage(params: {
  rootIdempotencyKey: string;
  cause: unknown;
}): string {
  const message = params.cause instanceof Error ? params.cause.message : String(params.cause);
  return `Hosted protocol plan failed: ${message} (root idempotency key: ${params.rootIdempotencyKey}). ${formatProtocolPlanResumeHint(params.rootIdempotencyKey)}`;
}

function formatHostedProtocolPlanPendingMessage(params: {
  rootIdempotencyKey: string;
  userOpHash: string;
}): string {
  return `Hosted protocol plan is still pending (root idempotency key: ${params.rootIdempotencyKey}, userOpHash: ${params.userOpHash}). ${formatProtocolPlanResumeHint(params.rootIdempotencyKey)}`;
}

async function attachReceiptSummaryIfPresent(params: {
  deps: Pick<CliDeps, "env">;
  network: string;
  stepOutput: ProtocolPlanStepOutput;
  plan: ProtocolExecutionPlanLike<CliProtocolStepAction>;
  step: ProtocolPlanStepLike;
  stepNumber: number;
  getStepReceiptDecoder?: (context: {
    plan: ProtocolExecutionPlanLike<CliProtocolStepAction>;
    step: ProtocolPlanStepLike;
    stepNumber: number;
  }) => ProtocolPlanStepReceiptDecoder | null | undefined;
}): Promise<void> {
  const receiptDecoder = params.getStepReceiptDecoder?.({
    plan: params.plan,
    step: params.step,
    stepNumber: params.stepNumber,
  });
  if (!receiptDecoder) {
    return;
  }

  const decoded = await tryDecodeProtocolPlanStepReceipt({
    deps: params.deps,
    network: params.network,
    transactionHash: params.stepOutput.transactionHash ?? "",
    plan: params.plan,
    step: params.step,
    stepNumber: params.stepNumber,
    decoder: receiptDecoder,
  });
  if (decoded.receiptSummary) {
    params.stepOutput.receiptSummary = decoded.receiptSummary;
  }
  if (decoded.receiptDecodeError) {
    params.stepOutput.receiptDecodeError = decoded.receiptDecodeError;
    params.stepOutput.warnings = [decoded.receiptDecodeError];
  }
}

function buildProtocolPlanOutput(params: {
  plan: ProtocolExecutionPlanLike<CliProtocolStepAction>;
  idempotencyKey: string;
  agentKey: string;
  walletMode: ProtocolPlanWalletMode;
  network: string;
  steps: ProtocolPlanStepOutput[];
  execution?: ProtocolPlanExecutionInfo;
  warnings: string[];
  dryRun: boolean;
}): ProtocolPlanExecutionOutput {
  return {
    ok: true,
    ...(params.dryRun ? { dryRun: true as const } : {}),
    idempotencyKey: params.idempotencyKey,
    agentKey: params.agentKey,
    walletMode: params.walletMode,
    action: params.plan.action,
    network: params.network,
    riskClass: params.plan.riskClass,
    summary: params.plan.summary,
    preconditions: [...params.plan.preconditions],
    expectedEvents: [...(params.plan.expectedEvents ?? [])],
    stepCount: params.steps.length,
    executedStepCount: params.dryRun ? 0 : params.steps.length,
    replayedStepCount: params.steps.filter((step) => step.replayed === true).length,
    ...(params.execution ? { execution: params.execution } : {}),
    warnings: params.warnings,
    steps: params.steps,
  };
}

export async function executeProtocolPlan(params: {
  deps: CliDeps;
  plan: ProtocolExecutionPlanLike<CliProtocolStepAction>;
  agent?: string;
  idempotencyKey?: string;
  dryRun?: boolean;
  getStepReceiptDecoder?: (context: {
    plan: ProtocolExecutionPlanLike<CliProtocolStepAction>;
    step: ProtocolPlanStepLike;
    stepNumber: number;
  }) => ProtocolPlanStepReceiptDecoder | null | undefined;
}): Promise<ProtocolPlanExecutionOutput> {
  const currentConfig = readConfig(params.deps);
  const agentKey = resolveAgentKey(params.agent, currentConfig.agent);
  const network = resolveNetwork(params.plan.network, params.deps);
  const rootIdempotencyKey = resolveExecIdempotencyKey(params.idempotencyKey, params.deps);
  const walletContext = resolveStoredProtocolPlanWalletContext({
    deps: params.deps,
    currentConfig,
    agentKey,
  });
  const executionTarget = walletContext.walletMode === "hosted" ? "hosted_api" : "local_wallet";
  const planWarnings = buildProtocolPlanWarnings(params.plan);
  const hostedExecutionRequest =
    walletContext.walletMode === "hosted"
      ? buildHostedProtocolPlanExecutionRequest({
          network,
          agentKey,
          plan: params.plan,
        })
      : null;

  if (params.dryRun === true) {
    const steps = params.plan.steps.map((step, index) => {
      const stepNumber = index + 1;
      const stepIdempotencyKey = resolveProtocolPlanStepIdempotencyKey({
        walletMode: walletContext.walletMode,
        rootIdempotencyKey,
        plan: params.plan,
        step,
        stepNumber,
      });
      const request = buildProtocolPlanStepRequest({
        walletMode: walletContext.walletMode,
        network,
        agentKey,
        plan: params.plan,
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
    });

    return buildProtocolPlanOutput({
      plan: params.plan,
      idempotencyKey: rootIdempotencyKey,
      agentKey,
      walletMode: walletContext.walletMode,
      network,
      steps,
      execution:
        walletContext.walletMode === "hosted"
          ? {
              mode: "hosted-batch",
              atomic: true,
              request: hostedExecutionRequest ?? undefined,
              idempotencyKey: rootIdempotencyKey,
            }
          : {
              mode: "local-sequential",
              atomic: false,
              idempotencyKey: rootIdempotencyKey,
            },
      warnings: [...planWarnings, DRY_RUN_ONLY_WARNING],
      dryRun: true,
    });
  }

  if (walletContext.walletMode === "hosted") {
    let result: Record<string, unknown>;
    try {
      result = await executeHostedProtocolPlan({
        deps: params.deps,
        executionRequest: hostedExecutionRequest!,
        idempotencyKey: rootIdempotencyKey,
      });
    } catch (error) {
      throw new Error(
        formatHostedProtocolPlanFailureMessage({
          rootIdempotencyKey,
          cause: error,
        })
      );
    }

    if (isHostedPendingStepResult(result)) {
      const userOpHash =
        typeof result.userOpHash === "string" && result.userOpHash.length > 0
          ? result.userOpHash
          : "unknown";
      throw new Error(
        formatHostedProtocolPlanPendingMessage({
          rootIdempotencyKey,
          userOpHash,
        })
      );
    }

    const replayed = result.replayed === true;
    const transactionHash =
      typeof result.transactionHash === "string" ? result.transactionHash : undefined;
    const explorerUrl = typeof result.explorerUrl === "string" ? result.explorerUrl : undefined;
    const steps: ProtocolPlanStepOutput[] = [];

    for (const [index, step] of params.plan.steps.entries()) {
      const stepNumber = index + 1;
      const request = buildHostedProtocolPlanStepRequest({
        network,
        agentKey,
        plan: params.plan,
        step,
      });
      const stepOutput = buildSucceededProtocolPlanStepOutput({
        baseOutput: buildProtocolPlanStepOutputBase({
          step,
          stepNumber,
          stepCount: params.plan.steps.length,
          idempotencyKey: rootIdempotencyKey,
          executionTarget,
          request,
        }),
        result,
      });

      await attachReceiptSummaryIfPresent({
        deps: params.deps,
        network,
        stepOutput,
        plan: params.plan,
        step,
        stepNumber,
        getStepReceiptDecoder: params.getStepReceiptDecoder,
      });

      steps.push(stepOutput);
    }

    return buildProtocolPlanOutput({
      plan: params.plan,
      idempotencyKey: rootIdempotencyKey,
      agentKey,
      walletMode: walletContext.walletMode,
      network,
      steps,
      execution: {
        mode: "hosted-batch",
        atomic: true,
        request: hostedExecutionRequest ?? undefined,
        idempotencyKey: rootIdempotencyKey,
        ...(typeof result.userOpHash === "string" ? { userOpHash: result.userOpHash } : {}),
        transactionHash: transactionHash ?? null,
        explorerUrl: explorerUrl ?? null,
        ...(replayed ? { replayed: true } : {}),
      },
      warnings: [...planWarnings, ...collectProtocolPlanStepWarnings(steps)],
      dryRun: false,
    });
  }

  const steps: ProtocolPlanStepOutput[] = [];
  for (const [index, step] of params.plan.steps.entries()) {
    const stepNumber = index + 1;
    const stepIdempotencyKey = resolveProtocolPlanStepIdempotencyKey({
      walletMode: walletContext.walletMode,
      rootIdempotencyKey,
      plan: params.plan,
      step,
      stepNumber,
    });
    const request = buildProtocolPlanStepRequest({
      walletMode: walletContext.walletMode,
      network,
      agentKey,
      plan: params.plan,
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
      result = await executeLocalProtocolPlanStep({
        deps: params.deps,
        walletContext,
        agentKey,
        network,
        step,
        idempotencyKey: stepIdempotencyKey,
      });
    } catch (error) {
      throw new Error(
        formatProtocolPlanStepFailureMessage({
          displayLabel: baseOutput.displayLabel,
          stepIdempotencyKey,
          rootIdempotencyKey,
          cause: error,
        })
      );
    }

    const stepOutput = buildSucceededProtocolPlanStepOutput({
      baseOutput,
      result,
    });

    await attachReceiptSummaryIfPresent({
      deps: params.deps,
      network,
      stepOutput,
      plan: params.plan,
      step,
      stepNumber,
      getStepReceiptDecoder: params.getStepReceiptDecoder,
    });

    steps.push(stepOutput);
  }

  return buildProtocolPlanOutput({
    plan: params.plan,
    idempotencyKey: rootIdempotencyKey,
    agentKey,
    walletMode: walletContext.walletMode,
    network,
    steps,
    execution: {
      mode: "local-sequential",
      atomic: false,
      idempotencyKey: rootIdempotencyKey,
    },
    warnings: [...planWarnings, ...collectProtocolPlanStepWarnings(steps)],
    dryRun: false,
  });
}
