import type {
  CliProtocolStepAction,
  CliProtocolStepRequest,
  ProtocolContractCallStep,
  ProtocolErc20ApprovalStep,
  ProtocolRiskClass,
} from "@cobuild/wire";

export type ProtocolPlanRiskClass = ProtocolRiskClass;

export type ProtocolPlanTransaction = ProtocolContractCallStep["transaction"];

export type ProtocolContractCallStepLike = ProtocolContractCallStep;

export type ProtocolErc20ApprovalStepLike = ProtocolErc20ApprovalStep;

export type ProtocolPlanStepLike = ProtocolContractCallStepLike | ProtocolErc20ApprovalStepLike;

export type ProtocolExecutionPlanLike<TAction extends CliProtocolStepAction = CliProtocolStepAction> = {
  network: string;
  action: TAction;
  riskClass: ProtocolPlanRiskClass;
  summary: string;
  preconditions: readonly string[];
  steps: readonly ProtocolPlanStepLike[];
  expectedEvents?: readonly string[];
};

export type ProtocolPlanWalletMode = "hosted" | "local";

export type RawTxProtocolPlanStepRequest = {
  kind: "tx";
  network: string;
  agentKey: string;
  to: string;
  data: string;
  valueEth: string;
};

export type HostedProtocolPlanStepRequest = CliProtocolStepRequest<CliProtocolStepAction> & {
  agentKey: string;
};

export type ProtocolPlanStepRequest = RawTxProtocolPlanStepRequest | HostedProtocolPlanStepRequest;

export interface ProtocolPlanStepReceiptDecoder<TSummary = unknown> {
  decode(params: {
    logs: readonly unknown[];
    plan: ProtocolExecutionPlanLike;
    step: ProtocolPlanStepLike;
    stepNumber: number;
    transactionHash: string;
  }): TSummary | Promise<TSummary>;
  serialize?(summary: TSummary): Record<string, unknown>;
}

export type ProtocolPlanStepOutput = {
  stepNumber: number;
  label: string;
  displayLabel: string;
  kind: ProtocolPlanStepLike["kind"];
  idempotencyKey: string;
  executionTarget: "hosted_api" | "local_wallet";
  transaction: ProtocolPlanTransaction;
  request: ProtocolPlanStepRequest;
  status: "dry-run" | "succeeded";
  warnings: string[];
  result?: Record<string, unknown>;
  transactionHash?: string;
  explorerUrl?: string;
  replayed?: boolean;
  receiptSummary?: Record<string, unknown>;
  receiptDecodeError?: string;
  contract?: string;
  functionName?: string;
  tokenAddress?: string;
  spenderAddress?: string;
  amount?: string;
};

export interface ProtocolPlanExecutionOutput extends Record<string, unknown> {
  ok: true;
  dryRun?: true;
  idempotencyKey: string;
  agentKey: string;
  walletMode: ProtocolPlanWalletMode;
  action: string;
  network: string;
  riskClass: ProtocolPlanRiskClass;
  summary: string;
  preconditions: string[];
  expectedEvents: string[];
  stepCount: number;
  executedStepCount: number;
  replayedStepCount: number;
  warnings: string[];
  steps: ProtocolPlanStepOutput[];
}
