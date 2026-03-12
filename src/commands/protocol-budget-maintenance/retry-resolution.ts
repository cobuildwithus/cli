import { buildBudgetRetryRemovedBudgetResolutionPlan } from "@cobuild/wire";
import type { CliDeps } from "../../types.js";
import {
  executeBudgetMaintenancePlan,
  requireString,
  resolveBudgetMaintenancePlanNetwork,
  type BudgetMaintenanceCommandOutput,
  type BudgetMaintenanceExecutionInput,
} from "./shared.js";

const BUDGET_RETRY_RESOLUTION_USAGE =
  "Usage: cli budget retry-resolution --controller <address> --item-id <bytes32> [--network <network>] [--agent <key>] [--idempotency-key <key>] [--dry-run]";

export interface BudgetRetryResolutionCommandInput extends BudgetMaintenanceExecutionInput {
  controller?: string;
  itemId?: string;
}

export async function executeBudgetRetryResolutionCommand(
  input: BudgetRetryResolutionCommandInput,
  deps: CliDeps
): Promise<BudgetMaintenanceCommandOutput> {
  const plan = buildBudgetRetryRemovedBudgetResolutionPlan({
    network: resolveBudgetMaintenancePlanNetwork(input, deps),
    controllerAddress: requireString(
      input.controller,
      BUDGET_RETRY_RESOLUTION_USAGE,
      "--controller"
    ),
    itemId: requireString(input.itemId, BUDGET_RETRY_RESOLUTION_USAGE, "--item-id"),
  });

  return executeBudgetMaintenancePlan({
    deps,
    input,
    outputAction: "budget.retry-resolution",
    plan,
  });
}
