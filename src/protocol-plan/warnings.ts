import { formatProtocolPlanReceiptDecodeWarning } from "./labels.js";
import type { ProtocolPlanStepLike, ProtocolPlanStepOutput } from "./types.js";

export const DRY_RUN_ONLY_WARNING = "Dry run only; no transactions were broadcast.";

export interface ProtocolPlanWarningsInput {
  preconditions: readonly string[];
  steps: readonly ProtocolPlanStepLike[];
}

export function buildProtocolPlanWarnings<TPlan extends ProtocolPlanWarningsInput>(plan: TPlan): string[] {
  const warnings: string[] = [];
  if (plan.preconditions.length > 0) {
    warnings.push(
      `Plan declares ${plan.preconditions.length} precondition(s) that the CLI does not verify automatically.`
    );
  }

  const approvalStepCount = plan.steps.filter((step) => step.kind === "erc20-approval").length;
  if (approvalStepCount > 0) {
    warnings.push(
      `Plan includes ${approvalStepCount} ERC-20 approval step(s); verify spender addresses and allowance amounts before execution.`
    );
  }

  return warnings;
}

export function collectProtocolPlanStepWarnings(steps: readonly ProtocolPlanStepOutput[]): string[] {
  return steps.flatMap((step) =>
    step.receiptDecodeError
      ? [
          formatProtocolPlanReceiptDecodeWarning({
            displayLabel: step.displayLabel,
            error: step.receiptDecodeError,
          }),
        ]
      : []
  );
}
