import { buildBudgetActivateRegisteredBudgetPlan } from "@cobuild/wire";
import type { BudgetMaintenanceCommandOutput, BudgetMaintenanceExecutionInput } from "./shared.js";
import {
  executeBudgetMaintenancePlan,
  requireString,
  resolveBudgetMaintenancePlanNetwork,
} from "./shared.js";
import type { CliDeps } from "../../types.js";

export interface BudgetActivateCommandInput extends BudgetMaintenanceExecutionInput {
  controller?: string;
  itemId?: string;
}

const BUDGET_ACTIVATE_USAGE =
  "Usage: cli budget activate --controller <address> --item-id <bytes32> [--network <network>] [--agent <key>] [--idempotency-key <key>] [--dry-run]";

export async function executeBudgetActivateCommand(
  input: BudgetActivateCommandInput,
  deps: CliDeps
): Promise<BudgetMaintenanceCommandOutput> {
  const plan = buildBudgetActivateRegisteredBudgetPlan({
    network: resolveBudgetMaintenancePlanNetwork(input, deps),
    controllerAddress: requireString(input.controller, BUDGET_ACTIVATE_USAGE, "--controller"),
    itemId: requireString(input.itemId, BUDGET_ACTIVATE_USAGE, "--item-id"),
  });

  return executeBudgetMaintenancePlan({
    deps,
    input,
    outputAction: "budget.activate",
    plan,
  });
}
