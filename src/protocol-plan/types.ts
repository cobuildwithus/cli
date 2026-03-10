export type ProtocolPlanRiskClass =
  | "stake"
  | "claim"
  | "governance"
  | "maintenance"
  | "economic"
  | string;

export type ProtocolPlanTransaction = {
  to: string;
  data: string;
  valueEth: string;
};

export type ProtocolContractCallStepLike = {
  kind: "contract-call";
  label: string;
  contract: string;
  functionName: string;
  transaction: ProtocolPlanTransaction;
};

export type ProtocolErc20ApprovalStepLike = {
  kind: "erc20-approval";
  label: string;
  tokenAddress: string;
  spenderAddress: string;
  amount: string;
  transaction: ProtocolPlanTransaction;
};

export type ProtocolPlanStepLike = ProtocolContractCallStepLike | ProtocolErc20ApprovalStepLike;

export type ProtocolExecutionPlanLike<TAction extends string = string> = {
  network: string;
  action: TAction;
  riskClass: ProtocolPlanRiskClass;
  summary: string;
  preconditions: readonly string[];
  steps: readonly ProtocolPlanStepLike[];
  expectedEvents?: readonly string[];
};

export type ProtocolPlanWalletMode = "hosted" | "local";

export type ProtocolPlanStepRequest = {
  kind: "tx";
  network: string;
  agentKey: string;
  to: string;
  data: string;
  valueEth: string;
};

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
