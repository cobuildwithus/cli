export function formatProtocolPlanStepLabel(params: {
  stepNumber: number;
  stepCount: number;
  label: string;
}): string {
  return `Step ${params.stepNumber}/${params.stepCount}: ${params.label}`;
}

export function formatProtocolPlanResumeHint(rootIdempotencyKey: string): string {
  return `Re-run the same command with --idempotency-key ${rootIdempotencyKey} to resume safely.`;
}

export function formatProtocolPlanStepFailureMessage(params: {
  displayLabel: string;
  stepIdempotencyKey: string;
  rootIdempotencyKey: string;
  cause: unknown;
}): string {
  const message = params.cause instanceof Error ? params.cause.message : String(params.cause);
  return `${params.displayLabel} failed: ${message} (step idempotency key: ${params.stepIdempotencyKey}, root idempotency key: ${params.rootIdempotencyKey}). ${formatProtocolPlanResumeHint(params.rootIdempotencyKey)}`;
}

export function formatProtocolPlanReceiptDecodeWarning(params: {
  displayLabel: string;
  error: string;
}): string {
  return `${params.displayLabel} receipt decode warning: ${params.error}`;
}
