import type {
  AllocationMechanismListingInput,
  BudgetTcrListingInput,
  GeneralizedTcrTotalCostsInput,
  RoundSubmissionInput,
  TcrActionPlan,
  ArbitratorActionPlan,
} from "@cobuild/wire";
import {
  buildAllocationMechanismAddListingPlan,
  buildArbitratorCommitVoteForPlan,
  buildArbitratorCommitVotePlan,
  buildArbitratorExecuteRulingPlan,
  buildArbitratorRevealVotePlan,
  buildArbitratorWithdrawInvalidRoundRewardsPlan,
  buildArbitratorWithdrawVoterRewardsPlan,
  buildBudgetTcrAddListingPlan,
  buildRoundSubmissionAddItemPlan,
  buildTcrChallengeRequestPlan,
  buildTcrExecuteRequestPlan,
  buildTcrExecuteRequestTimeoutPlan,
  buildTcrRemoveItemPlan,
  buildTcrSubmitEvidencePlan,
  buildTcrWithdrawFeesAndRewardsPlan,
} from "@cobuild/wire";
import type { CliDeps } from "../types.js";
import { readJsonInputObject, resolveNetwork } from "./shared.js";
import {
  executeParticipantProtocolPlan,
  type ParticipantPlanCommandInput,
  type ParticipantPlanCommandOutput,
} from "./protocol-participant-runtime.js";

const TCR_SUBMIT_BUDGET_USAGE =
  "Usage: cli tcr submit-budget --input-json <json>|--input-file <path>|--input-stdin [--dry-run]";
const TCR_SUBMIT_MECHANISM_USAGE =
  "Usage: cli tcr submit-mechanism --input-json <json>|--input-file <path>|--input-stdin [--dry-run]";
const TCR_SUBMIT_ROUND_SUBMISSION_USAGE =
  "Usage: cli tcr submit-round-submission --input-json <json>|--input-file <path>|--input-stdin [--dry-run]";
const TCR_REMOVE_USAGE =
  "Usage: cli tcr remove --registry <address> --deposit-token <address> --item-id <bytes32> --costs-json <json>|--costs-file <path>|--costs-stdin [--evidence <text>] [--network <network>] [--agent <key>] [--idempotency-key <key>] [--dry-run]";
const TCR_CHALLENGE_USAGE =
  "Usage: cli tcr challenge --registry <address> --deposit-token <address> --item-id <bytes32> --request-type <registrationRequested|clearingRequested|2|3> --costs-json <json>|--costs-file <path>|--costs-stdin [--evidence <text>] [--network <network>] [--agent <key>] [--idempotency-key <key>] [--dry-run]";
const TCR_EXECUTE_USAGE =
  "Usage: cli tcr execute --registry <address> --item-id <bytes32> [--network <network>] [--agent <key>] [--idempotency-key <key>] [--dry-run]";
const TCR_TIMEOUT_USAGE =
  "Usage: cli tcr timeout --registry <address> --item-id <bytes32> [--network <network>] [--agent <key>] [--idempotency-key <key>] [--dry-run]";
const TCR_EVIDENCE_USAGE =
  "Usage: cli tcr evidence --registry <address> --item-id <bytes32> --evidence <text> [--network <network>] [--agent <key>] [--idempotency-key <key>] [--dry-run]";
const TCR_WITHDRAW_USAGE =
  "Usage: cli tcr withdraw --registry <address> --beneficiary <address> --item-id <bytes32> --request-index <n> --round-index <n> [--network <network>] [--agent <key>] [--idempotency-key <key>] [--dry-run]";
const VOTE_COMMIT_USAGE =
  "Usage: cli vote commit --arbitrator <address> --dispute-id <n> [--commit-hash <bytes32>|--round <n> --choice <n> --salt <bytes32> [--voter <address>] [--reason <text>] [--chain-id <n>]] [--network <network>] [--agent <key>] [--idempotency-key <key>] [--dry-run]";
const VOTE_COMMIT_FOR_USAGE =
  "Usage: cli vote commit-for --arbitrator <address> --dispute-id <n> --voter <address> [--commit-hash <bytes32>|--round <n> --choice <n> --salt <bytes32> [--reason <text>] [--chain-id <n>]] [--network <network>] [--agent <key>] [--idempotency-key <key>] [--dry-run]";
const VOTE_REVEAL_USAGE =
  "Usage: cli vote reveal --arbitrator <address> --dispute-id <n> --voter <address> --choice <n> --salt <bytes32> [--reason <text>] [--network <network>] [--agent <key>] [--idempotency-key <key>] [--dry-run]";
const VOTE_REWARDS_USAGE =
  "Usage: cli vote rewards --arbitrator <address> --dispute-id <n> --round <n> --voter <address> [--network <network>] [--agent <key>] [--idempotency-key <key>] [--dry-run]";
const VOTE_INVALID_ROUND_REWARDS_USAGE =
  "Usage: cli vote invalid-round-rewards --arbitrator <address> --dispute-id <n> --round <n> [--network <network>] [--agent <key>] [--idempotency-key <key>] [--dry-run]";
const VOTE_EXECUTE_RULING_USAGE =
  "Usage: cli vote execute-ruling --arbitrator <address> --dispute-id <n> [--network <network>] [--agent <key>] [--idempotency-key <key>] [--dry-run]";

export interface TcrSubmitCommandInput extends ParticipantPlanCommandInput {
  inputJson?: string;
  inputFile?: string;
  inputStdin?: boolean;
}

export interface TcrRemoveCommandInput extends ParticipantPlanCommandInput {
  registry?: string;
  depositToken?: string;
  itemId?: string;
  evidence?: string;
  costsJson?: string;
  costsFile?: string;
  costsStdin?: boolean;
}

export interface TcrChallengeCommandInput extends TcrRemoveCommandInput {
  requestType?: string;
}

export interface TcrExecuteCommandInput extends ParticipantPlanCommandInput {
  registry?: string;
  itemId?: string;
}

export interface TcrEvidenceCommandInput extends ParticipantPlanCommandInput {
  registry?: string;
  itemId?: string;
  evidence?: string;
}

export interface TcrWithdrawCommandInput extends ParticipantPlanCommandInput {
  registry?: string;
  beneficiary?: string;
  itemId?: string;
  requestIndex?: string;
  roundIndex?: string;
}

export interface VoteCommitCommandInput extends ParticipantPlanCommandInput {
  arbitrator?: string;
  disputeId?: string;
  commitHash?: string;
  round?: string;
  voter?: string;
  choice?: string;
  reason?: string;
  salt?: string;
  chainId?: string;
}

export interface VoteRevealCommandInput extends ParticipantPlanCommandInput {
  arbitrator?: string;
  disputeId?: string;
  voter?: string;
  choice?: string;
  reason?: string;
  salt?: string;
}

export interface VoteRewardsCommandInput extends ParticipantPlanCommandInput {
  arbitrator?: string;
  disputeId?: string;
  round?: string;
  voter?: string;
}

export interface VoteInvalidRoundRewardsCommandInput extends ParticipantPlanCommandInput {
  arbitrator?: string;
  disputeId?: string;
  round?: string;
}

export interface VoteExecuteRulingCommandInput extends ParticipantPlanCommandInput {
  arbitrator?: string;
  disputeId?: string;
}

function requireString(value: string | undefined, usage: string, label: string): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`${usage}\n${label} is required.`);
  }
  return value.trim();
}

function pickPayloadOverride(
  payload: Record<string, unknown>,
  key: "agent" | "idempotencyKey"
): string | undefined {
  return typeof payload[key] === "string" ? payload[key] : undefined;
}

function resolvePlanNetwork(
  deps: Pick<CliDeps, "env">,
  inputNetwork: string | undefined,
  payloadNetwork?: unknown
): string {
  return resolveNetwork(typeof payloadNetwork === "string" ? payloadNetwork : inputNetwork, deps);
}

function withGovernancePlanNetwork<TPlan extends TcrActionPlan | ArbitratorActionPlan>(
  plan: TPlan,
  network: string
): TPlan {
  return {
    ...plan,
    network,
  };
}

function normalizeChallengeRequestTypeInput(
  value: string,
  usage: string
): "registrationRequested" | "clearingRequested" | 2 | 3 {
  if (value === "registrationRequested" || value === "clearingRequested") {
    return value;
  }
  if (value === "2") {
    return 2;
  }
  if (value === "3") {
    return 3;
  }
  throw new Error(
    `${usage}\nrequestType must be registrationRequested (2) or clearingRequested (3).`
  );
}

function buildExecutionInput(
  input: ParticipantPlanCommandInput,
  payload?: Record<string, unknown>
): ParticipantPlanCommandInput {
  return {
    ...input,
    ...(payload ? { agent: pickPayloadOverride(payload, "agent") ?? input.agent } : {}),
    ...(payload
      ? { idempotencyKey: pickPayloadOverride(payload, "idempotencyKey") ?? input.idempotencyKey }
      : {}),
  };
}

async function readRequiredObjectInput(
  usage: string,
  valueLabel: string,
  input: {
    inputJson?: string;
    inputFile?: string;
    inputStdin?: boolean;
  },
  deps: Pick<CliDeps, "fs" | "readStdin">
): Promise<Record<string, unknown>> {
  const payload = await readJsonInputObject(
    {
      json: input.inputJson,
      file: input.inputFile,
      stdin: input.inputStdin,
      jsonFlag: "--input-json",
      fileFlag: "--input-file",
      stdinFlag: "--input-stdin",
      usage,
      valueLabel,
    },
    deps
  );
  if (!payload) {
    throw new Error(`${usage}\n${valueLabel} is required.`);
  }
  return payload;
}

async function readRequiredCostsInput(
  usage: string,
  input: {
    costsJson?: string;
    costsFile?: string;
    costsStdin?: boolean;
  },
  deps: Pick<CliDeps, "fs" | "readStdin">
): Promise<Record<string, unknown>> {
  const costs = await readJsonInputObject(
    {
      json: input.costsJson,
      file: input.costsFile,
      stdin: input.costsStdin,
      jsonFlag: "--costs-json",
      fileFlag: "--costs-file",
      stdinFlag: "--costs-stdin",
      usage,
      valueLabel: "TCR costs",
    },
    deps
  );
  if (!costs) {
    throw new Error(`${usage}\nTCR costs are required.`);
  }
  return costs;
}

export async function executeTcrSubmitBudgetCommand(
  input: TcrSubmitCommandInput,
  deps: CliDeps
): Promise<ParticipantPlanCommandOutput> {
  const payload = await readRequiredObjectInput(
    TCR_SUBMIT_BUDGET_USAGE,
    "Budget TCR submit input",
    input,
    deps
  );
  const registryAddress = requireString(
    typeof payload.registry === "string" ? payload.registry : undefined,
    TCR_SUBMIT_BUDGET_USAGE,
    "payload.registry"
  );
  const depositTokenAddress = requireString(
    typeof payload.depositToken === "string" ? payload.depositToken : undefined,
    TCR_SUBMIT_BUDGET_USAGE,
    "payload.depositToken"
  );

  const plan = buildBudgetTcrAddListingPlan({
    registryAddress,
    depositTokenAddress,
    listing: payload.listing as BudgetTcrListingInput,
    costs: payload.costs as GeneralizedTcrTotalCostsInput,
  });

  return executeParticipantProtocolPlan({
    deps,
    family: "tcr",
    outputAction: "tcr.submit-budget",
    input: buildExecutionInput(input, payload),
    plan: withGovernancePlanNetwork(plan, resolvePlanNetwork(deps, input.network, payload.network)),
  });
}

export async function executeTcrSubmitMechanismCommand(
  input: TcrSubmitCommandInput,
  deps: CliDeps
): Promise<ParticipantPlanCommandOutput> {
  const payload = await readRequiredObjectInput(
    TCR_SUBMIT_MECHANISM_USAGE,
    "Allocation mechanism TCR submit input",
    input,
    deps
  );
  const registryAddress = requireString(
    typeof payload.registry === "string" ? payload.registry : undefined,
    TCR_SUBMIT_MECHANISM_USAGE,
    "payload.registry"
  );
  const depositTokenAddress = requireString(
    typeof payload.depositToken === "string" ? payload.depositToken : undefined,
    TCR_SUBMIT_MECHANISM_USAGE,
    "payload.depositToken"
  );

  const plan = buildAllocationMechanismAddListingPlan({
    registryAddress,
    depositTokenAddress,
    listing: payload.listing as AllocationMechanismListingInput,
    costs: payload.costs as GeneralizedTcrTotalCostsInput,
  });

  return executeParticipantProtocolPlan({
    deps,
    family: "tcr",
    outputAction: "tcr.submit-mechanism",
    input: buildExecutionInput(input, payload),
    plan: withGovernancePlanNetwork(plan, resolvePlanNetwork(deps, input.network, payload.network)),
  });
}

export async function executeTcrSubmitRoundSubmissionCommand(
  input: TcrSubmitCommandInput,
  deps: CliDeps
): Promise<ParticipantPlanCommandOutput> {
  const payload = await readRequiredObjectInput(
    TCR_SUBMIT_ROUND_SUBMISSION_USAGE,
    "Round submission TCR submit input",
    input,
    deps
  );
  const registryAddress = requireString(
    typeof payload.registry === "string" ? payload.registry : undefined,
    TCR_SUBMIT_ROUND_SUBMISSION_USAGE,
    "payload.registry"
  );
  const depositTokenAddress = requireString(
    typeof payload.depositToken === "string" ? payload.depositToken : undefined,
    TCR_SUBMIT_ROUND_SUBMISSION_USAGE,
    "payload.depositToken"
  );

  const plan = buildRoundSubmissionAddItemPlan({
    registryAddress,
    depositTokenAddress,
    submission: payload.submission as RoundSubmissionInput,
    costs: payload.costs as GeneralizedTcrTotalCostsInput,
  });

  return executeParticipantProtocolPlan({
    deps,
    family: "tcr",
    outputAction: "tcr.submit-round-submission",
    input: buildExecutionInput(input, payload),
    plan: withGovernancePlanNetwork(plan, resolvePlanNetwork(deps, input.network, payload.network)),
  });
}

export async function executeTcrRemoveCommand(
  input: TcrRemoveCommandInput,
  deps: CliDeps
): Promise<ParticipantPlanCommandOutput> {
  const plan = buildTcrRemoveItemPlan({
    registryAddress: requireString(input.registry, TCR_REMOVE_USAGE, "--registry"),
    depositTokenAddress: requireString(input.depositToken, TCR_REMOVE_USAGE, "--deposit-token"),
    itemId: requireString(input.itemId, TCR_REMOVE_USAGE, "--item-id"),
    ...(input.evidence !== undefined ? { evidence: input.evidence } : {}),
    costs: (await readRequiredCostsInput(TCR_REMOVE_USAGE, input, deps)) as GeneralizedTcrTotalCostsInput,
  });

  return executeParticipantProtocolPlan({
    deps,
    family: "tcr",
    outputAction: "tcr.remove",
    input,
    plan: withGovernancePlanNetwork(plan, resolvePlanNetwork(deps, input.network)),
  });
}

export async function executeTcrChallengeCommand(
  input: TcrChallengeCommandInput,
  deps: CliDeps
): Promise<ParticipantPlanCommandOutput> {
  const plan = buildTcrChallengeRequestPlan({
    registryAddress: requireString(input.registry, TCR_CHALLENGE_USAGE, "--registry"),
    depositTokenAddress: requireString(input.depositToken, TCR_CHALLENGE_USAGE, "--deposit-token"),
    itemId: requireString(input.itemId, TCR_CHALLENGE_USAGE, "--item-id"),
    requestType: normalizeChallengeRequestTypeInput(
      requireString(input.requestType, TCR_CHALLENGE_USAGE, "--request-type"),
      TCR_CHALLENGE_USAGE
    ),
    ...(input.evidence !== undefined ? { evidence: input.evidence } : {}),
    costs: (await readRequiredCostsInput(
      TCR_CHALLENGE_USAGE,
      input,
      deps
    )) as GeneralizedTcrTotalCostsInput,
  });

  return executeParticipantProtocolPlan({
    deps,
    family: "tcr",
    outputAction: "tcr.challenge",
    input,
    plan: withGovernancePlanNetwork(plan, resolvePlanNetwork(deps, input.network)),
  });
}

export async function executeTcrExecuteCommand(
  input: TcrExecuteCommandInput,
  deps: CliDeps
): Promise<ParticipantPlanCommandOutput> {
  return executeParticipantProtocolPlan({
    deps,
    family: "tcr",
    outputAction: "tcr.execute",
    input,
    plan: withGovernancePlanNetwork(
      buildTcrExecuteRequestPlan({
        registryAddress: requireString(input.registry, TCR_EXECUTE_USAGE, "--registry"),
        itemId: requireString(input.itemId, TCR_EXECUTE_USAGE, "--item-id"),
      }),
      resolvePlanNetwork(deps, input.network)
    ),
  });
}

export async function executeTcrTimeoutCommand(
  input: TcrExecuteCommandInput,
  deps: CliDeps
): Promise<ParticipantPlanCommandOutput> {
  return executeParticipantProtocolPlan({
    deps,
    family: "tcr",
    outputAction: "tcr.timeout",
    input,
    plan: withGovernancePlanNetwork(
      buildTcrExecuteRequestTimeoutPlan({
        registryAddress: requireString(input.registry, TCR_TIMEOUT_USAGE, "--registry"),
        itemId: requireString(input.itemId, TCR_TIMEOUT_USAGE, "--item-id"),
      }),
      resolvePlanNetwork(deps, input.network)
    ),
  });
}

export async function executeTcrEvidenceCommand(
  input: TcrEvidenceCommandInput,
  deps: CliDeps
): Promise<ParticipantPlanCommandOutput> {
  return executeParticipantProtocolPlan({
    deps,
    family: "tcr",
    outputAction: "tcr.evidence",
    input,
    plan: withGovernancePlanNetwork(
      buildTcrSubmitEvidencePlan({
        registryAddress: requireString(input.registry, TCR_EVIDENCE_USAGE, "--registry"),
        itemId: requireString(input.itemId, TCR_EVIDENCE_USAGE, "--item-id"),
        evidence: requireString(input.evidence, TCR_EVIDENCE_USAGE, "--evidence"),
      }),
      resolvePlanNetwork(deps, input.network)
    ),
  });
}

export async function executeTcrWithdrawCommand(
  input: TcrWithdrawCommandInput,
  deps: CliDeps
): Promise<ParticipantPlanCommandOutput> {
  return executeParticipantProtocolPlan({
    deps,
    family: "tcr",
    outputAction: "tcr.withdraw",
    input,
    plan: withGovernancePlanNetwork(
      buildTcrWithdrawFeesAndRewardsPlan({
        registryAddress: requireString(input.registry, TCR_WITHDRAW_USAGE, "--registry"),
        beneficiary: requireString(input.beneficiary, TCR_WITHDRAW_USAGE, "--beneficiary"),
        itemId: requireString(input.itemId, TCR_WITHDRAW_USAGE, "--item-id"),
        requestIndex: requireString(input.requestIndex, TCR_WITHDRAW_USAGE, "--request-index"),
        roundIndex: requireString(input.roundIndex, TCR_WITHDRAW_USAGE, "--round-index"),
      }),
      resolvePlanNetwork(deps, input.network)
    ),
  });
}

export async function executeVoteCommitCommand(
  input: VoteCommitCommandInput,
  deps: CliDeps
): Promise<ParticipantPlanCommandOutput> {
  return executeParticipantProtocolPlan({
    deps,
    family: "vote",
    outputAction: "vote.commit",
    input,
    plan: withGovernancePlanNetwork(
      buildArbitratorCommitVotePlan({
        arbitratorAddress: requireString(input.arbitrator, VOTE_COMMIT_USAGE, "--arbitrator"),
        disputeId: requireString(input.disputeId, VOTE_COMMIT_USAGE, "--dispute-id"),
        ...(input.commitHash?.trim().length ? { commitHash: input.commitHash } : {}),
        ...(input.round !== undefined ? { round: input.round } : {}),
        ...(input.voter !== undefined ? { voterAddress: input.voter } : {}),
        ...(input.choice !== undefined ? { choice: input.choice } : {}),
        ...(input.reason !== undefined ? { reason: input.reason } : {}),
        ...(input.salt !== undefined ? { salt: input.salt } : {}),
        ...(input.chainId !== undefined ? { chainId: input.chainId } : {}),
      }),
      resolvePlanNetwork(deps, input.network)
    ),
  });
}

export async function executeVoteCommitForCommand(
  input: VoteCommitCommandInput,
  deps: CliDeps
): Promise<ParticipantPlanCommandOutput> {
  return executeParticipantProtocolPlan({
    deps,
    family: "vote",
    outputAction: "vote.commit-for",
    input,
    plan: withGovernancePlanNetwork(
      buildArbitratorCommitVoteForPlan({
        arbitratorAddress: requireString(input.arbitrator, VOTE_COMMIT_FOR_USAGE, "--arbitrator"),
        disputeId: requireString(input.disputeId, VOTE_COMMIT_FOR_USAGE, "--dispute-id"),
        voterAddress: requireString(input.voter, VOTE_COMMIT_FOR_USAGE, "--voter"),
        ...(input.commitHash?.trim().length ? { commitHash: input.commitHash } : {}),
        ...(input.round !== undefined ? { round: input.round } : {}),
        ...(input.choice !== undefined ? { choice: input.choice } : {}),
        ...(input.reason !== undefined ? { reason: input.reason } : {}),
        ...(input.salt !== undefined ? { salt: input.salt } : {}),
        ...(input.chainId !== undefined ? { chainId: input.chainId } : {}),
      }),
      resolvePlanNetwork(deps, input.network)
    ),
  });
}

export async function executeVoteRevealCommand(
  input: VoteRevealCommandInput,
  deps: CliDeps
): Promise<ParticipantPlanCommandOutput> {
  return executeParticipantProtocolPlan({
    deps,
    family: "vote",
    outputAction: "vote.reveal",
    input,
    plan: withGovernancePlanNetwork(
      buildArbitratorRevealVotePlan({
        arbitratorAddress: requireString(input.arbitrator, VOTE_REVEAL_USAGE, "--arbitrator"),
        disputeId: requireString(input.disputeId, VOTE_REVEAL_USAGE, "--dispute-id"),
        voterAddress: requireString(input.voter, VOTE_REVEAL_USAGE, "--voter"),
        choice: requireString(input.choice, VOTE_REVEAL_USAGE, "--choice"),
        salt: requireString(input.salt, VOTE_REVEAL_USAGE, "--salt"),
        ...(input.reason !== undefined ? { reason: input.reason } : {}),
      }),
      resolvePlanNetwork(deps, input.network)
    ),
  });
}

export async function executeVoteRewardsCommand(
  input: VoteRewardsCommandInput,
  deps: CliDeps
): Promise<ParticipantPlanCommandOutput> {
  return executeParticipantProtocolPlan({
    deps,
    family: "vote",
    outputAction: "vote.rewards",
    input,
    plan: withGovernancePlanNetwork(
      buildArbitratorWithdrawVoterRewardsPlan({
        arbitratorAddress: requireString(input.arbitrator, VOTE_REWARDS_USAGE, "--arbitrator"),
        disputeId: requireString(input.disputeId, VOTE_REWARDS_USAGE, "--dispute-id"),
        round: requireString(input.round, VOTE_REWARDS_USAGE, "--round"),
        voterAddress: requireString(input.voter, VOTE_REWARDS_USAGE, "--voter"),
      }),
      resolvePlanNetwork(deps, input.network)
    ),
  });
}

export async function executeVoteInvalidRoundRewardsCommand(
  input: VoteInvalidRoundRewardsCommandInput,
  deps: CliDeps
): Promise<ParticipantPlanCommandOutput> {
  return executeParticipantProtocolPlan({
    deps,
    family: "vote",
    outputAction: "vote.invalid-round-rewards",
    input,
    plan: withGovernancePlanNetwork(
      buildArbitratorWithdrawInvalidRoundRewardsPlan({
        arbitratorAddress: requireString(
          input.arbitrator,
          VOTE_INVALID_ROUND_REWARDS_USAGE,
          "--arbitrator"
        ),
        disputeId: requireString(
          input.disputeId,
          VOTE_INVALID_ROUND_REWARDS_USAGE,
          "--dispute-id"
        ),
        round: requireString(input.round, VOTE_INVALID_ROUND_REWARDS_USAGE, "--round"),
      }),
      resolvePlanNetwork(deps, input.network)
    ),
  });
}

export async function executeVoteExecuteRulingCommand(
  input: VoteExecuteRulingCommandInput,
  deps: CliDeps
): Promise<ParticipantPlanCommandOutput> {
  return executeParticipantProtocolPlan({
    deps,
    family: "vote",
    outputAction: "vote.execute-ruling",
    input,
    plan: withGovernancePlanNetwork(
      buildArbitratorExecuteRulingPlan({
        arbitratorAddress: requireString(
          input.arbitrator,
          VOTE_EXECUTE_RULING_USAGE,
          "--arbitrator"
        ),
        disputeId: requireString(input.disputeId, VOTE_EXECUTE_RULING_USAGE, "--dispute-id"),
      }),
      resolvePlanNetwork(deps, input.network)
    ),
  });
}
