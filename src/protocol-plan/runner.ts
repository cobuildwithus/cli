import { readConfig } from "../config.js";
import { resolveLocalPayerPrivateKey } from "../farcaster/payer.js";
import { apiPost, asRecord } from "../transport.js";
import type { CliConfig, CliDeps } from "../types.js";
import {
  buildIdempotencyHeaders,
  resolveAgentKey,
  resolveExecIdempotencyKey,
} from "../commands/shared.js";
import { executeLocalTx } from "../wallet/local-exec.js";
import { requireStoredWalletConfig } from "../wallet/payer-config.js";
import { deriveProtocolPlanStepIdempotencyKey } from "./idempotency.js";
import {
  formatProtocolPlanStepFailureMessage,
  formatProtocolPlanStepLabel,
} from "./labels.js";
import { tryDecodeProtocolPlanStepReceipt } from "./receipt.js";
import type {
  ProtocolExecutionPlanLike,
  ProtocolPlanExecutionOutput,
  ProtocolPlanStepLike,
  ProtocolPlanStepOutput,
  ProtocolPlanStepReceiptDecoder,
  ProtocolPlanStepRequest,
  ProtocolPlanWalletMode,
} from "./types.js";
import {
  buildProtocolPlanWarnings,
  collectProtocolPlanStepWarnings,
} from "./warnings.js";

type ResolvedWalletContext =
  | {
      walletMode: "hosted";
    }
  | {
      walletMode: "local";
      privateKeyHex: ReturnType<typeof resolveLocalPayerPrivateKey>;
    };

function resolveProtocolPlanNetwork(inputNetwork: string | undefined, deps: Pick<CliDeps, "env">): string {
  const envNetwork = deps.env?.COBUILD_CLI_NETWORK;
  const rawNetwork = inputNetwork ?? envNetwork ?? "base";
  const normalized = rawNetwork.trim().toLowerCase();
  if (normalized === "base" || normalized === "base-mainnet") {
    return "base";
  }
  throw new Error(`Unsupported network "${rawNetwork}". Only "base" is supported.`);
}

function resolveProtocolPlanWalletContext(params: {
  deps: Pick<CliDeps, "fs" | "homedir" | "env">;
  currentConfig: CliConfig;
  agentKey: string;
}): ResolvedWalletContext {
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

function buildProtocolPlanStepRequest(params: {
  network: string;
  agentKey: string;
  step: ProtocolPlanStepLike;
}): ProtocolPlanStepRequest {
  return {
    kind: "tx",
    network: params.network,
    agentKey: params.agentKey,
    to: params.step.transaction.to,
    data: params.step.transaction.data,
    valueEth: params.step.transaction.valueEth,
  };
}

function buildProtocolPlanStepOutputBase(params: {
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

async function executeProtocolPlanStep(params: {
  deps: Pick<CliDeps, "fetch" | "fs" | "homedir" | "env">;
  walletContext: ResolvedWalletContext;
  agentKey: string;
  network: string;
  step: ProtocolPlanStepLike;
  idempotencyKey: string;
}): Promise<Record<string, unknown>> {
  const request = buildProtocolPlanStepRequest({
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

function buildProtocolPlanOutput(params: {
  plan: ProtocolExecutionPlanLike;
  idempotencyKey: string;
  agentKey: string;
  walletMode: ProtocolPlanWalletMode;
  network: string;
  steps: ProtocolPlanStepOutput[];
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
    warnings: params.warnings,
    steps: params.steps,
  };
}

export async function executeProtocolPlan(params: {
  deps: CliDeps;
  plan: ProtocolExecutionPlanLike;
  agent?: string;
  idempotencyKey?: string;
  dryRun?: boolean;
  getStepReceiptDecoder?: (context: {
    plan: ProtocolExecutionPlanLike;
    step: ProtocolPlanStepLike;
    stepNumber: number;
  }) => ProtocolPlanStepReceiptDecoder | null | undefined;
}): Promise<ProtocolPlanExecutionOutput> {
  const currentConfig = readConfig(params.deps);
  const agentKey = resolveAgentKey(params.agent, currentConfig.agent);
  const network = resolveProtocolPlanNetwork(params.plan.network, params.deps);
  const rootIdempotencyKey = resolveExecIdempotencyKey(params.idempotencyKey, params.deps);
  const walletContext = resolveProtocolPlanWalletContext({
    deps: params.deps,
    currentConfig,
    agentKey,
  });
  const executionTarget = walletContext.walletMode === "hosted" ? "hosted_api" : "local_wallet";
  const planWarnings = buildProtocolPlanWarnings(params.plan);

  if (params.dryRun === true) {
    const steps = params.plan.steps.map((step, index) => {
      const stepNumber = index + 1;
      const stepIdempotencyKey = deriveProtocolPlanStepIdempotencyKey({
        rootIdempotencyKey,
        plan: params.plan,
        step,
        stepNumber,
      });
      const request = buildProtocolPlanStepRequest({
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
    });

    return buildProtocolPlanOutput({
      plan: params.plan,
      idempotencyKey: rootIdempotencyKey,
      agentKey,
      walletMode: walletContext.walletMode,
      network,
      steps,
      warnings: [...planWarnings, "Dry run only; no transactions were broadcast."],
      dryRun: true,
    });
  }

  const steps: ProtocolPlanStepOutput[] = [];
  for (const [index, step] of params.plan.steps.entries()) {
    const stepNumber = index + 1;
    const stepIdempotencyKey = deriveProtocolPlanStepIdempotencyKey({
      rootIdempotencyKey,
      plan: params.plan,
      step,
      stepNumber,
    });
    const request = buildProtocolPlanStepRequest({
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
      result = await executeProtocolPlanStep({
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

    const stepOutput: ProtocolPlanStepOutput = {
      ...baseOutput,
      status: "succeeded",
      warnings: [],
      result,
    };
    const resultRecord = result;
    if (typeof resultRecord.transactionHash === "string") {
      stepOutput.transactionHash = resultRecord.transactionHash;
    }
    if (typeof resultRecord.explorerUrl === "string") {
      stepOutput.explorerUrl = resultRecord.explorerUrl;
    }
    if (resultRecord.replayed === true) {
      stepOutput.replayed = true;
    }

    const receiptDecoder = params.getStepReceiptDecoder?.({
      plan: params.plan,
      step,
      stepNumber,
    });
    if (receiptDecoder) {
      const decoded = await tryDecodeProtocolPlanStepReceipt({
        deps: params.deps,
        network,
        transactionHash: stepOutput.transactionHash ?? "",
        plan: params.plan,
        step,
        stepNumber,
        decoder: receiptDecoder,
      });
      if (decoded.receiptSummary) {
        stepOutput.receiptSummary = decoded.receiptSummary;
      }
      if (decoded.receiptDecodeError) {
        stepOutput.receiptDecodeError = decoded.receiptDecodeError;
        stepOutput.warnings = [decoded.receiptDecodeError];
      }
    }

    steps.push(stepOutput);
  }

  return buildProtocolPlanOutput({
    plan: params.plan,
    idempotencyKey: rootIdempotencyKey,
    agentKey,
    walletMode: walletContext.walletMode,
    network,
    steps,
    warnings: [...planWarnings, ...collectProtocolPlanStepWarnings(steps)],
    dryRun: false,
  });
}
