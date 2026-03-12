import { buildBudgetSyncBudgetTreasuriesPlan } from "@cobuild/wire";
import type {
  BudgetMaintenanceCommandOutput,
  BudgetMaintenanceExecutionInput,
} from "./shared.js";
import type { CliDeps } from "../../types.js";
import {
  executeBudgetMaintenancePlan,
  requireString,
  requireStringArray,
  resolveBudgetMaintenancePlanNetwork,
} from "./shared.js";

const BUDGET_SYNC_USAGE =
  "Usage: cli budget sync --controller <address> --item-id <bytes32>... [--network <network>] [--agent <key>] [--idempotency-key <key>] [--dry-run]";

export interface BudgetSyncCommandInput extends BudgetMaintenanceExecutionInput {
  controller?: string;
  itemId?: string[];
}

export async function executeBudgetSyncCommand(
  input: BudgetSyncCommandInput,
  deps: CliDeps
): Promise<BudgetMaintenanceCommandOutput> {
  const plan = buildBudgetSyncBudgetTreasuriesPlan({
    network: resolveBudgetMaintenancePlanNetwork(input, deps),
    controllerAddress: requireString(input.controller, BUDGET_SYNC_USAGE, "--controller"),
    itemIds: requireStringArray(input.itemId, BUDGET_SYNC_USAGE, "--item-id"),
  });

  return executeBudgetMaintenancePlan({
    deps,
    input,
    outputAction: "budget.sync",
    plan,
  });
}
