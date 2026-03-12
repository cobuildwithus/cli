import type { CliDeps } from "../types.js";
import type { CliProtocolStepAction } from "@cobuild/wire";
import { executeProtocolPlan } from "../protocol-plan/runner.js";
import type {
  ProtocolExecutionPlanLike,
  ProtocolPlanExecutionOutput,
  ProtocolPlanStepLike,
  ProtocolPlanStepReceiptDecoder,
} from "../protocol-plan/types.js";

export type ParticipantActionFamily = "tcr" | "vote" | "stake" | "premium" | "flow";

export interface ParticipantPlanCommandInput {
  agent?: string;
  dryRun?: boolean;
  idempotencyKey?: string;
  network?: string;
}

export type ParticipantPlanCommandOutput = ProtocolPlanExecutionOutput & {
  family: ParticipantActionFamily;
};

export async function executeParticipantProtocolPlan(params: {
  family: ParticipantActionFamily;
  plan: ProtocolExecutionPlanLike<CliProtocolStepAction>;
  input: ParticipantPlanCommandInput;
  deps: CliDeps;
  outputAction?: string;
  getStepReceiptDecoder?: (context: {
    plan: ProtocolExecutionPlanLike<CliProtocolStepAction>;
    step: ProtocolPlanStepLike;
    stepNumber: number;
  }) => ProtocolPlanStepReceiptDecoder | null | undefined;
}): Promise<ParticipantPlanCommandOutput> {
  const result = await executeProtocolPlan({
    deps: params.deps,
    plan: params.plan,
    agent: params.input.agent,
    idempotencyKey: params.input.idempotencyKey,
    dryRun: params.input.dryRun,
    ...(params.getStepReceiptDecoder
      ? { getStepReceiptDecoder: params.getStepReceiptDecoder }
      : {}),
  });

  return {
    ...result,
    family: params.family,
    ...(params.outputAction ? { action: params.outputAction } : {}),
  };
}
