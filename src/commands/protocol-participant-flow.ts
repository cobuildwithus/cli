import {
  buildFlowClearStaleAllocationPlan,
  buildFlowSyncAllocationForAccountPlan,
  buildFlowSyncAllocationPlan,
  type CliProtocolStepAction,
} from "@cobuild/wire";
import type { ProtocolExecutionPlanLike } from "../protocol-plan/types.js";
import type { CliDeps } from "../types.js";
import { resolveNetwork } from "./shared.js";
import {
  executeParticipantProtocolPlan,
  type ParticipantPlanCommandInput,
  type ParticipantPlanCommandOutput,
} from "./protocol-participant-runtime.js";
import {
  requireParticipantBigintLike,
  requireParticipantString,
} from "./participant-input-validation.js";

const FLOW_SYNC_ALLOCATION_USAGE =
  "Usage: cli flow sync-allocation --flow <address> --allocation-key <n> [--network <network>] [--agent <key>] [--idempotency-key <key>] [--dry-run]";
const FLOW_SYNC_ALLOCATION_FOR_ACCOUNT_USAGE =
  "Usage: cli flow sync-allocation-for-account --flow <address> --account <address> [--network <network>] [--agent <key>] [--idempotency-key <key>] [--dry-run]";
const FLOW_CLEAR_STALE_ALLOCATION_USAGE =
  "Usage: cli flow clear-stale-allocation --flow <address> --allocation-key <n> [--network <network>] [--agent <key>] [--idempotency-key <key>] [--dry-run]";

export interface FlowAllocationKeyCommandInput extends ParticipantPlanCommandInput {
  flow?: string;
  allocationKey?: string | number | bigint;
}

export interface FlowSyncAllocationForAccountCommandInput extends ParticipantPlanCommandInput {
  flow?: string;
  account?: string;
}

interface FlowAllocationKeyPlanInput {
  network: string;
  flowAddress: string;
  allocationKey: string | number | bigint;
}

function executeFlowPlan(
  input: ParticipantPlanCommandInput,
  deps: CliDeps,
  plan: ProtocolExecutionPlanLike<CliProtocolStepAction>
): Promise<ParticipantPlanCommandOutput> {
  return executeParticipantProtocolPlan({
    deps,
    family: "flow",
    input,
    plan,
  });
}

function buildFlowAllocationKeyPlan(
  input: FlowAllocationKeyCommandInput,
  deps: CliDeps,
  usage: string,
  buildPlan: (params: FlowAllocationKeyPlanInput) => ProtocolExecutionPlanLike<CliProtocolStepAction>
): ProtocolExecutionPlanLike<CliProtocolStepAction> {
  return buildPlan({
    network: resolveNetwork(input.network, deps),
    flowAddress: requireParticipantString(input.flow, usage, "--flow"),
    allocationKey: requireParticipantBigintLike(input.allocationKey, usage, "--allocation-key"),
  });
}

export async function executeFlowSyncAllocationCommand(
  input: FlowAllocationKeyCommandInput,
  deps: CliDeps
): Promise<ParticipantPlanCommandOutput> {
  return executeFlowPlan(
    input,
    deps,
    buildFlowAllocationKeyPlan(
      input,
      deps,
      FLOW_SYNC_ALLOCATION_USAGE,
      buildFlowSyncAllocationPlan
    )
  );
}

export async function executeFlowSyncAllocationForAccountCommand(
  input: FlowSyncAllocationForAccountCommandInput,
  deps: CliDeps
): Promise<ParticipantPlanCommandOutput> {
  const plan = buildFlowSyncAllocationForAccountPlan({
    network: resolveNetwork(input.network, deps),
    flowAddress: requireParticipantString(input.flow, FLOW_SYNC_ALLOCATION_FOR_ACCOUNT_USAGE, "--flow"),
    account: requireParticipantString(input.account, FLOW_SYNC_ALLOCATION_FOR_ACCOUNT_USAGE, "--account"),
  });

  return executeFlowPlan(input, deps, plan);
}

export async function executeFlowClearStaleAllocationCommand(
  input: FlowAllocationKeyCommandInput,
  deps: CliDeps
): Promise<ParticipantPlanCommandOutput> {
  return executeFlowPlan(
    input,
    deps,
    buildFlowAllocationKeyPlan(
      input,
      deps,
      FLOW_CLEAR_STALE_ALLOCATION_USAGE,
      buildFlowClearStaleAllocationPlan
    )
  );
}
