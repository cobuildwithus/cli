import type { CliDeps } from "../../types.js";
import {
  resolveNetwork,
} from "../shared.js";
import {
  formatProtocolPlanPendingMessage,
  formatProtocolPlanStepFailureMessage,
} from "../../protocol-plan/labels.js";
import {
  buildRawTxProtocolPlanCommandOutput,
  executeRawTxProtocolPlan,
} from "../../protocol-plan/executor-shared.js";
import type { ProtocolPlanExecutionOutput } from "../../protocol-plan/types.js";
import type { BudgetMaintenancePlan } from "@cobuild/wire";

export interface BudgetMaintenanceExecutionInput {
  agent?: string;
  dryRun?: boolean;
  idempotencyKey?: string;
  network?: string;
}

export type BudgetMaintenanceCommandOutput = ProtocolPlanExecutionOutput & {
  family: "budget";
};

export function requireString(value: string | undefined, usage: string, label: string): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`${usage}\n${label} is required.`);
  }
  return value.trim();
}

export function requireStringArray(
  values: readonly string[] | undefined,
  usage: string,
  label: string
): readonly string[] {
  if (!values || values.length === 0) {
    throw new Error(`${usage}\n${label} is required.`);
  }

  const normalized = values
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (normalized.length === 0) {
    throw new Error(`${usage}\n${label} is required.`);
  }
  return normalized;
}

export function resolveBudgetMaintenancePlanNetwork(
  input: Pick<BudgetMaintenanceExecutionInput, "network">,
  deps: Pick<CliDeps, "env">
): string {
  return resolveNetwork(input.network, deps);
}

export async function executeBudgetMaintenancePlan(params: {
  deps: CliDeps;
  input: BudgetMaintenanceExecutionInput;
  outputAction: string;
  plan: BudgetMaintenancePlan;
}): Promise<BudgetMaintenanceCommandOutput> {
  const execution = await executeRawTxProtocolPlan({
    deps: params.deps,
    input: params.input,
    plan: params.plan,
    formatStepFailureMessage: formatProtocolPlanStepFailureMessage,
    formatPendingMessage: formatProtocolPlanPendingMessage,
  });

  return buildRawTxProtocolPlanCommandOutput({
    family: "budget",
    action: params.outputAction,
    execution,
  });
}
