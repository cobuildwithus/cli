import { buildBudgetPruneTerminalBudgetPlan } from "@cobuild/wire";
import type { CliDeps } from "../../types.js";
import type {
  BudgetMaintenanceCommandOutput,
  BudgetMaintenanceExecutionInput,
} from "./shared.js";
import {
  executeBudgetMaintenancePlan,
  requireString,
  resolveBudgetMaintenancePlanNetwork,
} from "./shared.js";

export interface BudgetPruneCommandInput extends BudgetMaintenanceExecutionInput {
  controller?: string;
  budgetTreasury?: string;
}

const BUDGET_PRUNE_USAGE =
  "Usage: cli budget prune --controller <address> --budget-treasury <address> [--network <network>] [--agent <key>] [--idempotency-key <key>] [--dry-run]";

export async function executeBudgetPruneCommand(
  input: BudgetPruneCommandInput,
  deps: CliDeps
): Promise<BudgetMaintenanceCommandOutput> {
  const plan = buildBudgetPruneTerminalBudgetPlan({
    network: resolveBudgetMaintenancePlanNetwork(input, deps),
    controllerAddress: requireString(input.controller, BUDGET_PRUNE_USAGE, "--controller"),
    budgetTreasuryAddress: requireString(
      input.budgetTreasury,
      BUDGET_PRUNE_USAGE,
      "--budget-treasury"
    ),
  });

  return executeBudgetMaintenancePlan({
    deps,
    input,
    outputAction: "budget.prune",
    plan,
  });
}
