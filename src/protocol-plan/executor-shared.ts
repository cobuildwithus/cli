import { formatProtocolPlanStepLabel } from "./labels.js";
import type {
  ProtocolPlanStepLike,
  ProtocolPlanStepOutput,
  ProtocolPlanStepRequest,
  RawTxProtocolPlanStepRequest,
} from "./types.js";

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
