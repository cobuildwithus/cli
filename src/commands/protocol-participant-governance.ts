import {
  encodeAbiParameters,
  encodePacked,
  isHex,
  keccak256,
  type Abi,
  type Hex,
} from "viem";
import {
  BASE_CHAIN_ID,
  budgetTcrAbi,
  erc20VotesArbitratorAbi,
  normalizeBytes32,
  normalizeEvmAddress,
  normalizeHexBytes,
  normalizeUnsignedDecimal,
} from "@cobuild/wire";
import type { CliDeps } from "../types.js";
import { readJsonInputObject, resolveNetwork } from "./shared.js";
import {
  buildParticipantApprovalPlan,
  buildParticipantContractCallStep,
  executeParticipantProtocolPlan,
  type ParticipantExecutionPlan,
  type ParticipantPlanCommandInput,
  type ParticipantPlanCommandOutput,
} from "./protocol-participant-runtime.js";

const GENERALIZED_TCR_ABI = budgetTcrAbi as Abi;
const ARBITRATOR_ABI = erc20VotesArbitratorAbi as Abi;

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

const budgetListingParameters = [
  {
    name: "listing",
    type: "tuple",
    components: [
      {
        name: "metadata",
        type: "tuple",
        components: [
          { name: "title", type: "string" },
          { name: "description", type: "string" },
          { name: "image", type: "string" },
          { name: "tagline", type: "string" },
          { name: "url", type: "string" },
        ],
      },
      { name: "fundingDeadline", type: "uint64" },
      { name: "executionDuration", type: "uint64" },
      { name: "activationThreshold", type: "uint256" },
      { name: "runwayCap", type: "uint256" },
      {
        name: "oracleConfig",
        type: "tuple",
        components: [
          { name: "oracleSpecHash", type: "bytes32" },
          { name: "assertionPolicyHash", type: "bytes32" },
        ],
      },
    ],
  },
] as const;

const mechanismListingParameters = [
  {
    name: "listing",
    type: "tuple",
    components: [
      {
        name: "metadata",
        type: "tuple",
        components: [
          { name: "title", type: "string" },
          { name: "description", type: "string" },
          { name: "image", type: "string" },
          { name: "tagline", type: "string" },
          { name: "url", type: "string" },
        ],
      },
      { name: "duration", type: "uint64" },
      { name: "fundingDeadline", type: "uint64" },
      { name: "minBudgetFunding", type: "uint256" },
      { name: "maxBudgetFunding", type: "uint256" },
      {
        name: "deploymentConfig",
        type: "tuple",
        components: [
          { name: "mechanismFactory", type: "address" },
          { name: "mechanismConfig", type: "bytes" },
        ],
      },
    ],
  },
] as const;

const roundSubmissionParameters = [
  {
    name: "submission",
    type: "tuple",
    components: [
      { name: "source", type: "uint8" },
      { name: "postId", type: "bytes32" },
      { name: "recipient", type: "address" },
    ],
  },
] as const;

const commitHashParameters = [
  { name: "chainId", type: "uint256" },
  { name: "arbitrator", type: "address" },
  { name: "disputeId", type: "uint256" },
  { name: "round", type: "uint256" },
  { name: "voter", type: "address" },
  { name: "choice", type: "uint256" },
  { name: "reason", type: "string" },
  { name: "salt", type: "bytes32" },
] as const;

type MetadataInput = {
  title: string;
  description: string;
  image: string;
  tagline?: string;
  url?: string;
};

type BudgetListingInput = {
  metadata: MetadataInput;
  fundingDeadline: string | number | bigint;
  executionDuration: string | number | bigint;
  activationThreshold: string | number | bigint;
  runwayCap: string | number | bigint;
  oracleConfig: {
    oracleSpecHash: string;
    assertionPolicyHash: string;
  };
};

type AllocationMechanismListingInput = {
  metadata: MetadataInput;
  duration: string | number | bigint;
  fundingDeadline: string | number | bigint;
  minBudgetFunding: string | number | bigint;
  maxBudgetFunding: string | number | bigint;
  deploymentConfig: {
    mechanismFactory: string;
    mechanismConfig?: string;
  };
};

type RoundSubmissionInput = {
  source: string | number | bigint;
  postId: string;
  recipient: string;
};

type GeneralizedTcrTotalCostsInput = {
  addItemCost: string | number | bigint;
  removeItemCost: string | number | bigint;
  challengeSubmissionCost: string | number | bigint;
  challengeRemovalCost: string | number | bigint;
  arbitrationCost: string | number | bigint;
};

type SubmitBudgetPayload = ParticipantPlanCommandInput & {
  registry: string;
  depositToken: string;
  listing: BudgetListingInput;
  costs: GeneralizedTcrTotalCostsInput;
};

type SubmitMechanismPayload = ParticipantPlanCommandInput & {
  registry: string;
  depositToken: string;
  listing: AllocationMechanismListingInput;
  costs: GeneralizedTcrTotalCostsInput;
};

type SubmitRoundSubmissionPayload = ParticipantPlanCommandInput & {
  registry: string;
  depositToken: string;
  submission: RoundSubmissionInput;
  costs: GeneralizedTcrTotalCostsInput;
};

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeUint(value: string | number | bigint, label: string): bigint {
  return BigInt(normalizeUnsignedDecimal(value, label));
}

function normalizeUint8(value: string | number | bigint, label: string): number {
  const normalized = normalizeUint(value, label);
  if (normalized > 255n) {
    throw new Error(`${label} exceeds the supported range.`);
  }
  return Number(normalized);
}

function normalizeUint64(value: string | number | bigint, label: string): bigint {
  const normalized = normalizeUint(value, label);
  if (normalized > (1n << 64n) - 1n) {
    throw new Error(`${label} exceeds the supported range.`);
  }
  return normalized;
}

function normalizeText(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string.`);
  }
  return value;
}

function normalizeRequiredText(value: unknown, label: string): string {
  const normalized = normalizeText(value, label);
  if (normalized.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return normalized;
}

function normalizeHexData(value: string, label: string, allowEmpty = true): Hex {
  const normalized = value.trim().toLowerCase();
  if (!isHex(normalized)) {
    throw new Error(`${label} must be valid hex bytes with 0x prefix.`);
  }
  if (!allowEmpty && normalized === "0x") {
    throw new Error(`${label} must not be empty hex bytes.`);
  }
  return normalized as Hex;
}

function normalizeRequestType(
  value: string | number | bigint,
  label = "requestType"
): 2 | 3 {
  if (typeof value === "string") {
    const normalized = value.trim();
    if (normalized === "registrationRequested") return 2;
    if (normalized === "clearingRequested") return 3;
    if (!/^\d+$/.test(normalized)) {
      throw new Error(
        `${label} must be registrationRequested (2) or clearingRequested (3).`
      );
    }
  }

  const numeric = Number(normalizeUint(value, label));
  if (numeric !== 2 && numeric !== 3) {
    throw new Error(`${label} must be registrationRequested (2) or clearingRequested (3).`);
  }
  return numeric as 2 | 3;
}

function normalizeMetadata(input: unknown): MetadataInput & { tagline: string; url: string } {
  if (!isRecord(input)) {
    throw new Error("listing.metadata must be an object.");
  }
  return {
    title: normalizeRequiredText(input.title, "listing.metadata.title"),
    description: normalizeRequiredText(input.description, "listing.metadata.description"),
    image: normalizeRequiredText(input.image, "listing.metadata.image"),
    tagline: normalizeText(input.tagline ?? "", "listing.metadata.tagline"),
    url: normalizeText(input.url ?? "", "listing.metadata.url"),
  };
}

function normalizeCosts(input: unknown): NormalizedTcrCosts {
  if (!isRecord(input)) {
    throw new Error("costs must be an object.");
  }
  return {
    addItemCost: normalizeUint(input.addItemCost as string | number | bigint, "costs.addItemCost"),
    removeItemCost: normalizeUint(
      input.removeItemCost as string | number | bigint,
      "costs.removeItemCost"
    ),
    challengeSubmissionCost: normalizeUint(
      input.challengeSubmissionCost as string | number | bigint,
      "costs.challengeSubmissionCost"
    ),
    challengeRemovalCost: normalizeUint(
      input.challengeRemovalCost as string | number | bigint,
      "costs.challengeRemovalCost"
    ),
    arbitrationCost: normalizeUint(
      input.arbitrationCost as string | number | bigint,
      "costs.arbitrationCost"
    ),
  };
}

type NormalizedTcrCosts = {
  addItemCost: bigint;
  removeItemCost: bigint;
  challengeSubmissionCost: bigint;
  challengeRemovalCost: bigint;
  arbitrationCost: bigint;
};

function getTcrRequiredApprovalAmount(params: {
  action: "addItem" | "removeItem" | "challengeRequest";
  requestType?: 2 | 3;
  costs: NormalizedTcrCosts;
}): bigint {
  switch (params.action) {
    case "addItem":
      return params.costs.addItemCost;
    case "removeItem":
      return params.costs.removeItemCost;
    case "challengeRequest":
      return params.requestType === 2
        ? params.costs.challengeSubmissionCost
        : params.costs.challengeRemovalCost;
  }
}

function encodeBudgetListing(listing: unknown): Hex {
  if (!isRecord(listing)) {
    throw new Error("listing must be an object.");
  }
  return encodeAbiParameters(budgetListingParameters, [
    {
      metadata: normalizeMetadata(listing.metadata),
      fundingDeadline: normalizeUint64(
        listing.fundingDeadline as string | number | bigint,
        "listing.fundingDeadline"
      ),
      executionDuration: normalizeUint64(
        listing.executionDuration as string | number | bigint,
        "listing.executionDuration"
      ),
      activationThreshold: normalizeUint(
        listing.activationThreshold as string | number | bigint,
        "listing.activationThreshold"
      ),
      runwayCap: normalizeUint(listing.runwayCap as string | number | bigint, "listing.runwayCap"),
      oracleConfig: {
        oracleSpecHash: normalizeBytes32(
          String((listing.oracleConfig as Record<string, unknown>)?.oracleSpecHash),
          "listing.oracleConfig.oracleSpecHash"
        ),
        assertionPolicyHash: normalizeBytes32(
          String((listing.oracleConfig as Record<string, unknown>)?.assertionPolicyHash),
          "listing.oracleConfig.assertionPolicyHash"
        ),
      },
    },
  ]) as Hex;
}

function encodeMechanismListing(listing: unknown): Hex {
  if (!isRecord(listing)) {
    throw new Error("listing must be an object.");
  }

  const fundingDeadline = normalizeUint64(
    listing.fundingDeadline as string | number | bigint,
    "listing.fundingDeadline"
  );
  const minBudgetFunding = normalizeUint(
    listing.minBudgetFunding as string | number | bigint,
    "listing.minBudgetFunding"
  );
  const maxBudgetFunding = normalizeUint(
    listing.maxBudgetFunding as string | number | bigint,
    "listing.maxBudgetFunding"
  );
  if (maxBudgetFunding !== 0n && minBudgetFunding !== 0n && maxBudgetFunding < minBudgetFunding) {
    throw new Error(
      "listing.maxBudgetFunding must be zero or greater than or equal to minBudgetFunding."
    );
  }
  if (
    (fundingDeadline === 0n && minBudgetFunding !== 0n) ||
    (fundingDeadline !== 0n && minBudgetFunding === 0n)
  ) {
    throw new Error(
      "listing.fundingDeadline and listing.minBudgetFunding must either both be zero or both be set."
    );
  }

  return encodeAbiParameters(mechanismListingParameters, [
    {
      metadata: normalizeMetadata(listing.metadata),
      duration: normalizeUint64(listing.duration as string | number | bigint, "listing.duration"),
      fundingDeadline,
      minBudgetFunding,
      maxBudgetFunding,
      deploymentConfig: {
        mechanismFactory: normalizeEvmAddress(
          String((listing.deploymentConfig as Record<string, unknown>)?.mechanismFactory),
          "listing.deploymentConfig.mechanismFactory"
        ),
        mechanismConfig: normalizeHexData(
          String((listing.deploymentConfig as Record<string, unknown>)?.mechanismConfig ?? "0x"),
          "listing.deploymentConfig.mechanismConfig"
        ),
      },
    },
  ]) as Hex;
}

function encodeRoundSubmission(submission: unknown): Hex {
  if (!isRecord(submission)) {
    throw new Error("submission must be an object.");
  }
  const normalized = {
    source: normalizeUint8(submission.source as string | number | bigint, "submission.source"),
    postId: normalizeHexBytes(String(submission.postId), 32, "submission.postId"),
    recipient: normalizeEvmAddress(String(submission.recipient), "submission.recipient"),
  };
  return encodeAbiParameters(roundSubmissionParameters, [normalized]) as Hex;
}

function buildTcrPlan(params: {
  action: string;
  summary: string;
  registry: string;
  steps: ReturnType<typeof buildParticipantApprovalPlan>["steps"];
  callLabel: string;
  functionName: string;
  args: readonly unknown[];
  expectedEvents: readonly string[];
  preconditions?: readonly string[];
}): ParticipantExecutionPlan {
  const registry = normalizeEvmAddress(params.registry, "registry");
  return {
    family: "tcr",
    action: params.action,
    riskClass: "governance",
    summary: params.summary,
    preconditions: params.preconditions ?? [],
    expectedEvents: params.expectedEvents,
    steps: [
      ...params.steps,
      buildParticipantContractCallStep({
        contract: "GeneralizedTCR",
        functionName: params.functionName,
        label: params.callLabel,
        to: registry,
        abi: GENERALIZED_TCR_ABI,
        args: params.args,
      }),
    ],
  };
}

function buildTcrApproval(params: {
  registry: string;
  depositToken: string;
  amount: bigint;
}) {
  return buildParticipantApprovalPlan({
    mode: "force",
    tokenAddress: params.depositToken,
    spenderAddress: params.registry,
    requiredAmount: params.amount,
    approvalAmount: params.amount,
    tokenLabel: "deposit token",
    spenderLabel: "registry",
  });
}

function computeArbitratorCommitHash(params: {
  arbitrator: string;
  disputeId: string | number | bigint;
  round: string | number | bigint;
  voter: string;
  choice: string | number | bigint;
  reason?: string;
  salt: string;
  chainId?: string | number | bigint;
}): Hex {
  return keccak256(
    encodeAbiParameters(commitHashParameters, [
      normalizeUint(params.chainId ?? BASE_CHAIN_ID, "chainId"),
      normalizeEvmAddress(params.arbitrator, "arbitrator"),
      normalizeUint(params.disputeId, "disputeId"),
      normalizeUint(params.round, "round"),
      normalizeEvmAddress(params.voter, "voter"),
      normalizeUint(params.choice, "choice"),
      normalizeText(params.reason ?? "", "reason"),
      normalizeBytes32(params.salt, "salt"),
    ])
  ) as Hex;
}

function buildArbitratorPlan(params: {
  action: string;
  summary: string;
  arbitrator: string;
  functionName: string;
  label: string;
  args: readonly unknown[];
  expectedEvents: readonly string[];
}): ParticipantExecutionPlan {
  return {
    family: "vote",
    action: params.action,
    riskClass: "governance",
    summary: params.summary,
    preconditions: [],
    expectedEvents: params.expectedEvents,
    steps: [
      buildParticipantContractCallStep({
        contract: "ERC20VotesArbitrator",
        functionName: params.functionName,
        label: params.label,
        to: params.arbitrator,
        abi: ARBITRATOR_ABI,
        args: params.args,
      }),
    ],
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
): Promise<NormalizedTcrCosts> {
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
  return normalizeCosts(costs);
}

function requireString(
  value: string | undefined,
  usage: string,
  label: string
): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`${usage}\n${label} is required.`);
  }
  return value.trim();
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
  const registry = requireString(String(payload.registry ?? ""), TCR_SUBMIT_BUDGET_USAGE, "payload.registry");
  const depositToken = requireString(
    String(payload.depositToken ?? ""),
    TCR_SUBMIT_BUDGET_USAGE,
    "payload.depositToken"
  );
  const listing = payload.listing;
  const costs = normalizeCosts(payload.costs);
  const approval = buildTcrApproval({
    registry,
    depositToken,
    amount: getTcrRequiredApprovalAmount({
      action: "addItem",
      costs,
    }),
  });
  const itemData = encodeBudgetListing(listing);
  const itemId = keccak256(itemData);

  return executeParticipantProtocolPlan({
    deps,
    input: {
      ...input,
      network: typeof payload.network === "string" ? payload.network : input.network,
      agent: typeof payload.agent === "string" ? payload.agent : input.agent,
      idempotencyKey:
        typeof payload.idempotencyKey === "string" ? payload.idempotencyKey : input.idempotencyKey,
    },
    plan: buildTcrPlan({
      action: "tcr.submit-budget",
      summary: "Approve the TCR deposit token and submit a budget listing.",
      registry,
      steps: approval.steps,
      preconditions: approval.preconditions,
      callLabel: "Submit budget listing",
      functionName: "addItem",
      args: [itemData],
      expectedEvents: [
        "ItemSubmitted",
        "RequestSubmitted",
        "RequestEvidenceGroupID",
        "ItemStatusChange",
        "SubmissionDepositPaid",
        itemId,
      ],
    }),
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
  const registry = requireString(
    String(payload.registry ?? ""),
    TCR_SUBMIT_MECHANISM_USAGE,
    "payload.registry"
  );
  const depositToken = requireString(
    String(payload.depositToken ?? ""),
    TCR_SUBMIT_MECHANISM_USAGE,
    "payload.depositToken"
  );
  const listing = payload.listing;
  const costs = normalizeCosts(payload.costs);
  const approval = buildTcrApproval({
    registry,
    depositToken,
    amount: getTcrRequiredApprovalAmount({
      action: "addItem",
      costs,
    }),
  });
  const itemData = encodeMechanismListing(listing);

  return executeParticipantProtocolPlan({
    deps,
    input: {
      ...input,
      network: typeof payload.network === "string" ? payload.network : input.network,
      agent: typeof payload.agent === "string" ? payload.agent : input.agent,
      idempotencyKey:
        typeof payload.idempotencyKey === "string" ? payload.idempotencyKey : input.idempotencyKey,
    },
    plan: buildTcrPlan({
      action: "tcr.submit-mechanism",
      summary: "Approve the TCR deposit token and submit an allocation mechanism listing.",
      registry,
      steps: approval.steps,
      preconditions: approval.preconditions,
      callLabel: "Submit mechanism listing",
      functionName: "addItem",
      args: [itemData],
      expectedEvents: [
        "ItemSubmitted",
        "RequestSubmitted",
        "RequestEvidenceGroupID",
        "ItemStatusChange",
        "SubmissionDepositPaid",
      ],
    }),
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
  const registry = requireString(
    String(payload.registry ?? ""),
    TCR_SUBMIT_ROUND_SUBMISSION_USAGE,
    "payload.registry"
  );
  const depositToken = requireString(
    String(payload.depositToken ?? ""),
    TCR_SUBMIT_ROUND_SUBMISSION_USAGE,
    "payload.depositToken"
  );
  const submission = payload.submission;
  if (!isRecord(submission)) {
    throw new Error("payload.submission must be an object.");
  }
  const costs = normalizeCosts(payload.costs);
  const approval = buildTcrApproval({
    registry,
    depositToken,
    amount: getTcrRequiredApprovalAmount({
      action: "addItem",
      costs,
    }),
  });
  const itemData = encodeRoundSubmission(submission);
  const itemId = keccak256(
    encodePacked(
      ["uint8", "bytes32"],
      [
        normalizeUint8(submission.source as string | number | bigint, "submission.source"),
        normalizeHexBytes(String(submission.postId), 32, "submission.postId"),
      ]
    )
  );

  return executeParticipantProtocolPlan({
    deps,
    input: {
      ...input,
      network: typeof payload.network === "string" ? payload.network : input.network,
      agent: typeof payload.agent === "string" ? payload.agent : input.agent,
      idempotencyKey:
        typeof payload.idempotencyKey === "string" ? payload.idempotencyKey : input.idempotencyKey,
    },
    plan: buildTcrPlan({
      action: "tcr.submit-round-submission",
      summary: "Approve the TCR deposit token and submit a round submission.",
      registry,
      steps: approval.steps,
      preconditions: approval.preconditions,
      callLabel: "Submit round submission",
      functionName: "addItem",
      args: [itemData],
      expectedEvents: [
        "ItemSubmitted",
        "RequestSubmitted",
        "RequestEvidenceGroupID",
        "ItemStatusChange",
        "SubmissionDepositPaid",
        itemId,
      ],
    }),
  });
}

export async function executeTcrRemoveCommand(
  input: TcrRemoveCommandInput,
  deps: CliDeps
): Promise<ParticipantPlanCommandOutput> {
  const registry = requireString(input.registry, TCR_REMOVE_USAGE, "--registry");
  const depositToken = requireString(input.depositToken, TCR_REMOVE_USAGE, "--deposit-token");
  const itemId = normalizeBytes32(requireString(input.itemId, TCR_REMOVE_USAGE, "--item-id"), "itemId");
  const costs = await readRequiredCostsInput(TCR_REMOVE_USAGE, input, deps);
  const approval = buildTcrApproval({
    registry,
    depositToken,
    amount: getTcrRequiredApprovalAmount({
      action: "removeItem",
      costs,
    }),
  });

  return executeParticipantProtocolPlan({
    deps,
    input,
    plan: buildTcrPlan({
      action: "tcr.remove",
      summary: "Approve the TCR deposit token and request item removal.",
      registry,
      steps: approval.steps,
      preconditions: approval.preconditions,
      callLabel: "Request TCR item removal",
      functionName: "removeItem",
      args: [itemId, input.evidence ?? ""],
      expectedEvents: ["RequestSubmitted", "RequestEvidenceGroupID", "ItemStatusChange"],
    }),
  });
}

export async function executeTcrChallengeCommand(
  input: TcrChallengeCommandInput,
  deps: CliDeps
): Promise<ParticipantPlanCommandOutput> {
  const registry = requireString(input.registry, TCR_CHALLENGE_USAGE, "--registry");
  const depositToken = requireString(input.depositToken, TCR_CHALLENGE_USAGE, "--deposit-token");
  const itemId = normalizeBytes32(
    requireString(input.itemId, TCR_CHALLENGE_USAGE, "--item-id"),
    "itemId"
  );
  const requestType = normalizeRequestType(
    requireString(input.requestType, TCR_CHALLENGE_USAGE, "--request-type")
  );
  const costs = await readRequiredCostsInput(TCR_CHALLENGE_USAGE, input, deps);
  const approval = buildTcrApproval({
    registry,
    depositToken,
    amount: getTcrRequiredApprovalAmount({
      action: "challengeRequest",
      requestType,
      costs,
    }),
  });

  return executeParticipantProtocolPlan({
    deps,
    input,
    plan: buildTcrPlan({
      action: "tcr.challenge",
      summary: "Approve the TCR deposit token and challenge the pending request.",
      registry,
      steps: approval.steps,
      preconditions: approval.preconditions,
      callLabel: "Challenge TCR request",
      functionName: "challengeRequest",
      args: [itemId, input.evidence ?? ""],
      expectedEvents: ["ItemStatusChange", "Dispute", "DisputeCreation", "DisputeCreated"],
    }),
  });
}

export async function executeTcrExecuteCommand(
  input: TcrExecuteCommandInput,
  deps: CliDeps
): Promise<ParticipantPlanCommandOutput> {
  const registry = requireString(input.registry, TCR_EXECUTE_USAGE, "--registry");
  const itemId = normalizeBytes32(
    requireString(input.itemId, TCR_EXECUTE_USAGE, "--item-id"),
    "itemId"
  );

  return executeParticipantProtocolPlan({
    deps,
    input,
    plan: buildTcrPlan({
      action: "tcr.execute",
      summary: "Execute an unchallenged TCR request after the challenge window closes.",
      registry,
      steps: [],
      callLabel: "Execute TCR request",
      functionName: "executeRequest",
      args: [itemId],
      expectedEvents: ["ItemStatusChange", "SubmissionDepositTransferred"],
    }),
  });
}

export async function executeTcrTimeoutCommand(
  input: TcrExecuteCommandInput,
  deps: CliDeps
): Promise<ParticipantPlanCommandOutput> {
  const registry = requireString(input.registry, TCR_TIMEOUT_USAGE, "--registry");
  const itemId = normalizeBytes32(
    requireString(input.itemId, TCR_TIMEOUT_USAGE, "--item-id"),
    "itemId"
  );

  return executeParticipantProtocolPlan({
    deps,
    input,
    plan: buildTcrPlan({
      action: "tcr.timeout",
      summary:
        "Execute a disputed TCR request after the dispute timeout path becomes available.",
      registry,
      steps: [],
      callLabel: "Execute timed-out TCR request",
      functionName: "executeRequestTimeout",
      args: [itemId],
      expectedEvents: ["Ruling", "ItemStatusChange", "SubmissionDepositTransferred"],
    }),
  });
}

export async function executeTcrEvidenceCommand(
  input: TcrEvidenceCommandInput,
  deps: CliDeps
): Promise<ParticipantPlanCommandOutput> {
  const registry = requireString(input.registry, TCR_EVIDENCE_USAGE, "--registry");
  const itemId = normalizeBytes32(
    requireString(input.itemId, TCR_EVIDENCE_USAGE, "--item-id"),
    "itemId"
  );
  const evidence = requireString(input.evidence, TCR_EVIDENCE_USAGE, "--evidence");

  return executeParticipantProtocolPlan({
    deps,
    input,
    plan: buildTcrPlan({
      action: "tcr.evidence",
      summary: "Submit evidence for the latest TCR request cycle.",
      registry,
      steps: [],
      callLabel: "Submit TCR evidence",
      functionName: "submitEvidence",
      args: [itemId, evidence],
      expectedEvents: ["Evidence"],
    }),
  });
}

export async function executeTcrWithdrawCommand(
  input: TcrWithdrawCommandInput,
  deps: CliDeps
): Promise<ParticipantPlanCommandOutput> {
  const registry = requireString(input.registry, TCR_WITHDRAW_USAGE, "--registry");
  const beneficiary = normalizeEvmAddress(
    requireString(input.beneficiary, TCR_WITHDRAW_USAGE, "--beneficiary"),
    "beneficiary"
  );
  const itemId = normalizeBytes32(
    requireString(input.itemId, TCR_WITHDRAW_USAGE, "--item-id"),
    "itemId"
  );
  const requestIndex = normalizeUint(
    requireString(input.requestIndex, TCR_WITHDRAW_USAGE, "--request-index"),
    "requestIndex"
  );
  const roundIndex = normalizeUint(
    requireString(input.roundIndex, TCR_WITHDRAW_USAGE, "--round-index"),
    "roundIndex"
  );

  return executeParticipantProtocolPlan({
    deps,
    input,
    plan: buildTcrPlan({
      action: "tcr.withdraw",
      summary: "Withdraw resolved TCR fees and rewards for a contributor.",
      registry,
      steps: [],
      callLabel: "Withdraw TCR fees and rewards",
      functionName: "withdrawFeesAndRewards",
      args: [beneficiary, itemId, requestIndex, roundIndex],
      expectedEvents: [],
    }),
  });
}

export async function executeVoteCommitCommand(
  input: VoteCommitCommandInput,
  deps: CliDeps
): Promise<ParticipantPlanCommandOutput> {
  const arbitrator = requireString(input.arbitrator, VOTE_COMMIT_USAGE, "--arbitrator");
  const disputeId = requireString(input.disputeId, VOTE_COMMIT_USAGE, "--dispute-id");
  const commitHash =
    input.commitHash?.trim().length
      ? normalizeBytes32(input.commitHash, "commitHash")
      : computeArbitratorCommitHash({
          arbitrator,
          disputeId,
          round: requireString(input.round, VOTE_COMMIT_USAGE, "--round"),
          voter: requireString(input.voter, VOTE_COMMIT_USAGE, "--voter"),
          choice: requireString(input.choice, VOTE_COMMIT_USAGE, "--choice"),
          reason: input.reason,
          salt: requireString(input.salt, VOTE_COMMIT_USAGE, "--salt"),
          chainId: input.chainId,
        });

  return executeParticipantProtocolPlan({
    deps,
    input,
    plan: buildArbitratorPlan({
      action: "vote.commit",
      summary: "Commit a vote hash for the current arbitrator round.",
      arbitrator,
      label: "Commit vote hash",
      functionName: "commitVote",
      args: [normalizeUint(disputeId, "disputeId"), commitHash],
      expectedEvents: ["VoteCommitted"],
    }),
  });
}

export async function executeVoteCommitForCommand(
  input: VoteCommitCommandInput,
  deps: CliDeps
): Promise<ParticipantPlanCommandOutput> {
  const arbitrator = requireString(input.arbitrator, VOTE_COMMIT_FOR_USAGE, "--arbitrator");
  const disputeId = requireString(input.disputeId, VOTE_COMMIT_FOR_USAGE, "--dispute-id");
  const voter = normalizeEvmAddress(
    requireString(input.voter, VOTE_COMMIT_FOR_USAGE, "--voter"),
    "voter"
  );
  const commitHash =
    input.commitHash?.trim().length
      ? normalizeBytes32(input.commitHash, "commitHash")
      : computeArbitratorCommitHash({
          arbitrator,
          disputeId,
          round: requireString(input.round, VOTE_COMMIT_FOR_USAGE, "--round"),
          voter,
          choice: requireString(input.choice, VOTE_COMMIT_FOR_USAGE, "--choice"),
          reason: input.reason,
          salt: requireString(input.salt, VOTE_COMMIT_FOR_USAGE, "--salt"),
          chainId: input.chainId,
        });

  return executeParticipantProtocolPlan({
    deps,
    input,
    plan: buildArbitratorPlan({
      action: "vote.commit-for",
      summary: "Commit a delegated vote hash for the current arbitrator round.",
      arbitrator,
      label: "Commit delegated vote hash",
      functionName: "commitVoteFor",
      args: [normalizeUint(disputeId, "disputeId"), voter, commitHash],
      expectedEvents: ["VoteCommitted"],
    }),
  });
}

export async function executeVoteRevealCommand(
  input: VoteRevealCommandInput,
  deps: CliDeps
): Promise<ParticipantPlanCommandOutput> {
  const arbitrator = requireString(input.arbitrator, VOTE_REVEAL_USAGE, "--arbitrator");
  const disputeId = normalizeUint(
    requireString(input.disputeId, VOTE_REVEAL_USAGE, "--dispute-id"),
    "disputeId"
  );
  const voter = normalizeEvmAddress(requireString(input.voter, VOTE_REVEAL_USAGE, "--voter"), "voter");
  const choice = normalizeUint(
    requireString(input.choice, VOTE_REVEAL_USAGE, "--choice"),
    "choice"
  );
  const salt = normalizeBytes32(requireString(input.salt, VOTE_REVEAL_USAGE, "--salt"), "salt");

  return executeParticipantProtocolPlan({
    deps,
    input,
    plan: buildArbitratorPlan({
      action: "vote.reveal",
      summary: "Reveal a previously committed arbitrator vote.",
      arbitrator,
      label: "Reveal vote",
      functionName: "revealVote",
      args: [disputeId, voter, choice, input.reason ?? "", salt],
      expectedEvents: ["VoteRevealed"],
    }),
  });
}

export async function executeVoteRewardsCommand(
  input: VoteRewardsCommandInput,
  deps: CliDeps
): Promise<ParticipantPlanCommandOutput> {
  const arbitrator = requireString(input.arbitrator, VOTE_REWARDS_USAGE, "--arbitrator");
  const disputeId = normalizeUint(
    requireString(input.disputeId, VOTE_REWARDS_USAGE, "--dispute-id"),
    "disputeId"
  );
  const round = normalizeUint(requireString(input.round, VOTE_REWARDS_USAGE, "--round"), "round");
  const voter = normalizeEvmAddress(requireString(input.voter, VOTE_REWARDS_USAGE, "--voter"), "voter");

  return executeParticipantProtocolPlan({
    deps,
    input,
    plan: buildArbitratorPlan({
      action: "vote.rewards",
      summary: "Withdraw arbitrator round rewards for a voter.",
      arbitrator,
      label: "Withdraw voter rewards",
      functionName: "withdrawVoterRewards",
      args: [disputeId, round, voter],
      expectedEvents: ["RewardWithdrawn", "SlashRewardsWithdrawn"],
    }),
  });
}

export async function executeVoteInvalidRoundRewardsCommand(
  input: VoteInvalidRoundRewardsCommandInput,
  deps: CliDeps
): Promise<ParticipantPlanCommandOutput> {
  const arbitrator = requireString(
    input.arbitrator,
    VOTE_INVALID_ROUND_REWARDS_USAGE,
    "--arbitrator"
  );
  const disputeId = normalizeUint(
    requireString(input.disputeId, VOTE_INVALID_ROUND_REWARDS_USAGE, "--dispute-id"),
    "disputeId"
  );
  const round = normalizeUint(
    requireString(input.round, VOTE_INVALID_ROUND_REWARDS_USAGE, "--round"),
    "round"
  );

  return executeParticipantProtocolPlan({
    deps,
    input,
    plan: buildArbitratorPlan({
      action: "vote.invalid-round-rewards",
      summary: "Withdraw invalid-round rewards when no votes were cast.",
      arbitrator,
      label: "Withdraw invalid-round rewards",
      functionName: "withdrawInvalidRoundRewards",
      args: [disputeId, round],
      expectedEvents: [],
    }),
  });
}

export async function executeVoteExecuteRulingCommand(
  input: VoteExecuteRulingCommandInput,
  deps: CliDeps
): Promise<ParticipantPlanCommandOutput> {
  const arbitrator = requireString(input.arbitrator, VOTE_EXECUTE_RULING_USAGE, "--arbitrator");
  const disputeId = normalizeUint(
    requireString(input.disputeId, VOTE_EXECUTE_RULING_USAGE, "--dispute-id"),
    "disputeId"
  );

  return executeParticipantProtocolPlan({
    deps,
    input,
    plan: buildArbitratorPlan({
      action: "vote.execute-ruling",
      summary: "Execute the solved arbitrator ruling and settle the dispute callback.",
      arbitrator,
      label: "Execute ruling",
      functionName: "executeRuling",
      args: [disputeId],
      expectedEvents: ["DisputeExecuted", "Ruling", "ItemStatusChange"],
    }),
  });
}
