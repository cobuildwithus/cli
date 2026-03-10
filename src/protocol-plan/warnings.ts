import { formatProtocolPlanReceiptDecodeWarning } from "./labels.js";
import type { ProtocolExecutionPlanLike, ProtocolPlanStepOutput } from "./types.js";

export function buildProtocolPlanWarnings(plan: ProtocolExecutionPlanLike): string[] {
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
