import { executeCanonicalToolOnly } from "./tool-execution.js";
import type { CliDeps } from "../types.js";
import { normalizeKeyedRemoteToolResponse } from "./remote-tool.js";

const BUDGET_INSPECT_USAGE = "Usage: cli budget inspect <identifier>";
const BUDGET_CANONICAL_TOOL_NAMES = ["get-budget", "getBudget", "budget.inspect"];

export interface BudgetInspectCommandInput {
  identifier?: string;
}

export interface BudgetInspectCommandOutput extends Record<string, unknown> {
  budget: unknown;
  ok?: boolean;
  untrusted: true;
  source: "remote_tool";
  warnings: string[];
}

export async function executeBudgetInspectCommand(
  input: BudgetInspectCommandInput,
  deps: CliDeps
): Promise<BudgetInspectCommandOutput> {
  const identifier = input.identifier?.trim() ?? "";
  if (!identifier) {
    throw new Error(BUDGET_INSPECT_USAGE);
  }

  const response = await executeCanonicalToolOnly(deps, {
    canonicalToolNames: BUDGET_CANONICAL_TOOL_NAMES,
    input: {
      identifier,
    },
  });

  return normalizeKeyedRemoteToolResponse(response, "budget") as BudgetInspectCommandOutput;
}
