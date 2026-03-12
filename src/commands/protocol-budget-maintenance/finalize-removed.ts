import { buildBudgetFinalizeRemovedBudgetPlan } from "@cobuild/wire";
import type { BudgetMaintenanceCommandOutput, BudgetMaintenanceExecutionInput } from "./shared.js";
import {
  executeBudgetMaintenancePlan,
  requireString,
  resolveBudgetMaintenancePlanNetwork,
} from "./shared.js";
import type { CliDeps } from "../../types.js";

export interface BudgetFinalizeRemovedCommandInput extends BudgetMaintenanceExecutionInput {
  controller?: string;
  itemId?: string;
}

const BUDGET_FINALIZE_REMOVED_USAGE =
  "Usage: cli budget finalize-removed --controller <address> --item-id <bytes32> [--network <network>] [--agent <key>] [--idempotency-key <key>] [--dry-run]";

export async function executeBudgetFinalizeRemovedCommand(
  input: BudgetFinalizeRemovedCommandInput,
  deps: CliDeps
): Promise<BudgetMaintenanceCommandOutput> {
  const plan = buildBudgetFinalizeRemovedBudgetPlan({
    network: resolveBudgetMaintenancePlanNetwork(input, deps),
    controllerAddress: requireString(input.controller, BUDGET_FINALIZE_REMOVED_USAGE, "--controller"),
    itemId: requireString(input.itemId, BUDGET_FINALIZE_REMOVED_USAGE, "--item-id"),
  });

  return executeBudgetMaintenancePlan({
    deps,
    input,
    outputAction: "budget.finalize-removed",
    plan,
  });
}
