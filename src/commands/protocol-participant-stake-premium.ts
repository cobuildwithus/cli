import { type Abi } from "viem";
import {
  goalStakeVaultAbi,
  premiumEscrowAbi,
  normalizeEvmAddress,
} from "@cobuild/wire";
import type { CliDeps } from "../types.js";
import {
  buildParticipantApprovalPlan,
  buildParticipantContractCallStep,
  executeParticipantProtocolPlan,
  type ParticipantExecutionPlan,
  type ParticipantPlanCommandInput,
  type ParticipantPlanCommandOutput,
} from "./protocol-participant-runtime.js";

const GOAL_STAKE_VAULT_ABI = goalStakeVaultAbi as Abi;
const PREMIUM_ESCROW_ABI = premiumEscrowAbi as Abi;

const STAKE_DEPOSIT_GOAL_USAGE =
  "Usage: cli stake deposit-goal --vault <address> --token <address> --amount <n> [--approval-mode <auto|force|skip>] [--current-allowance <n>] [--approval-amount <n>] [--network <network>] [--agent <key>] [--idempotency-key <key>] [--dry-run]";
const STAKE_DEPOSIT_COBUILD_USAGE =
  "Usage: cli stake deposit-cobuild --vault <address> --token <address> --amount <n> [--approval-mode <auto|force|skip>] [--current-allowance <n>] [--approval-amount <n>] [--network <network>] [--agent <key>] [--idempotency-key <key>] [--dry-run]";
const STAKE_PREPARE_UNDERWRITER_WITHDRAWAL_USAGE =
  "Usage: cli stake prepare-underwriter-withdrawal --vault <address> --max-budgets <n> [--network <network>] [--agent <key>] [--idempotency-key <key>] [--dry-run]";
const STAKE_WITHDRAW_GOAL_USAGE =
  "Usage: cli stake withdraw-goal --vault <address> --amount <n> --recipient <address> [--network <network>] [--agent <key>] [--idempotency-key <key>] [--dry-run]";
const STAKE_WITHDRAW_COBUILD_USAGE =
  "Usage: cli stake withdraw-cobuild --vault <address> --amount <n> --recipient <address> [--network <network>] [--agent <key>] [--idempotency-key <key>] [--dry-run]";
const PREMIUM_CHECKPOINT_USAGE =
  "Usage: cli premium checkpoint --escrow <address> --account <address> [--network <network>] [--agent <key>] [--idempotency-key <key>] [--dry-run]";
const PREMIUM_CLAIM_USAGE =
  "Usage: cli premium claim --escrow <address> --recipient <address> [--network <network>] [--agent <key>] [--idempotency-key <key>] [--dry-run]";

export interface StakeDepositCommandInput extends ParticipantPlanCommandInput {
  vault?: string;
  token?: string;
  amount?: string | number | bigint;
  approvalMode?: "auto" | "force" | "skip";
  currentAllowance?: string | number | bigint;
  approvalAmount?: string | number | bigint;
}

export interface StakePrepareUnderwriterWithdrawalCommandInput extends ParticipantPlanCommandInput {
  vault?: string;
  maxBudgets?: string | number | bigint;
}

export interface StakeWithdrawCommandInput extends ParticipantPlanCommandInput {
  vault?: string;
  amount?: string | number | bigint;
  recipient?: string;
}

export interface PremiumCheckpointCommandInput extends ParticipantPlanCommandInput {
  escrow?: string;
  account?: string;
}

export interface PremiumClaimCommandInput extends ParticipantPlanCommandInput {
  escrow?: string;
  recipient?: string;
}

function normalizeProtocolBigInt(value: string | number | bigint, label: string): bigint {
  if (typeof value === "bigint") {
    if (value < 0n) {
      throw new Error(`${label} must be a non-negative integer.`);
    }
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
      throw new Error(`${label} must be a non-negative integer.`);
    }
    return BigInt(value);
  }
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return BigInt(normalized);
}

function requireString(value: string | undefined, usage: string, label: string): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`${usage}\n${label} is required.`);
  }
  return value.trim();
}

function requireBigintLike(
  value: string | number | bigint | undefined,
  usage: string,
  label: string
): string | number | bigint {
  if (value === undefined) {
    throw new Error(`${usage}\n${label} is required.`);
  }
  if (typeof value === "string") {
    if (value.trim().length === 0) {
      throw new Error(`${usage}\n${label} is required.`);
    }
    return value.trim();
  }
  return value;
}

function buildStakePlan(params: {
  action: string;
  summary: string;
  preconditions?: readonly string[];
  steps: ParticipantExecutionPlan["steps"];
  expectedEvents: readonly string[];
}): ParticipantExecutionPlan {
  return {
    family: "stake",
    action: params.action,
    riskClass: "stake",
    summary: params.summary,
    preconditions: params.preconditions ?? [],
    expectedEvents: params.expectedEvents,
    steps: params.steps,
  };
}

function buildPremiumPlan(params: {
  action: string;
  summary: string;
  steps: ParticipantExecutionPlan["steps"];
  expectedEvents: readonly string[];
}): ParticipantExecutionPlan {
  return {
    family: "premium",
    action: params.action,
    riskClass: "claim",
    summary: params.summary,
    preconditions: [],
    expectedEvents: params.expectedEvents,
    steps: params.steps,
  };
}

export async function executeStakeDepositGoalCommand(
  input: StakeDepositCommandInput,
  deps: CliDeps
): Promise<ParticipantPlanCommandOutput> {
  const stakeVaultAddress = normalizeEvmAddress(
    requireString(input.vault, STAKE_DEPOSIT_GOAL_USAGE, "--vault"),
    "stakeVaultAddress"
  );
  const goalTokenAddress = normalizeEvmAddress(
    requireString(input.token, STAKE_DEPOSIT_GOAL_USAGE, "--token"),
    "goalTokenAddress"
  );
  const amount = normalizeProtocolBigInt(
    requireBigintLike(input.amount, STAKE_DEPOSIT_GOAL_USAGE, "--amount"),
    "amount"
  );
  const approval = buildParticipantApprovalPlan({
    tokenAddress: goalTokenAddress,
    spenderAddress: stakeVaultAddress,
    requiredAmount: amount,
    tokenLabel: "goal token",
    spenderLabel: "stake vault",
    ...(input.approvalMode ? { mode: input.approvalMode } : {}),
    ...(input.currentAllowance ? { currentAllowance: input.currentAllowance } : {}),
    ...(input.approvalAmount ? { approvalAmount: input.approvalAmount } : {}),
  });

  return executeParticipantProtocolPlan({
    deps,
    input,
    plan: buildStakePlan({
      action: "stake.deposit-goal",
      summary: `Deposit goal tokens into stake vault ${stakeVaultAddress}.`,
      preconditions: approval.preconditions,
      steps: [
        ...approval.steps,
        buildParticipantContractCallStep({
          contract: "GoalStakeVault",
          functionName: "depositGoal",
          label: "Deposit goal stake",
          to: stakeVaultAddress,
          abi: GOAL_STAKE_VAULT_ABI,
          args: [amount],
        }),
      ],
      expectedEvents: ["GoalStaked"],
    }),
  });
}

export async function executeStakeDepositCobuildCommand(
  input: StakeDepositCommandInput,
  deps: CliDeps
): Promise<ParticipantPlanCommandOutput> {
  const stakeVaultAddress = normalizeEvmAddress(
    requireString(input.vault, STAKE_DEPOSIT_COBUILD_USAGE, "--vault"),
    "stakeVaultAddress"
  );
  const cobuildTokenAddress = normalizeEvmAddress(
    requireString(input.token, STAKE_DEPOSIT_COBUILD_USAGE, "--token"),
    "cobuildTokenAddress"
  );
  const amount = normalizeProtocolBigInt(
    requireBigintLike(input.amount, STAKE_DEPOSIT_COBUILD_USAGE, "--amount"),
    "amount"
  );
  const approval = buildParticipantApprovalPlan({
    tokenAddress: cobuildTokenAddress,
    spenderAddress: stakeVaultAddress,
    requiredAmount: amount,
    tokenLabel: "cobuild token",
    spenderLabel: "stake vault",
    ...(input.approvalMode ? { mode: input.approvalMode } : {}),
    ...(input.currentAllowance ? { currentAllowance: input.currentAllowance } : {}),
    ...(input.approvalAmount ? { approvalAmount: input.approvalAmount } : {}),
  });

  return executeParticipantProtocolPlan({
    deps,
    input,
    plan: buildStakePlan({
      action: "stake.deposit-cobuild",
      summary: `Deposit cobuild tokens into stake vault ${stakeVaultAddress}.`,
      preconditions: approval.preconditions,
      steps: [
        ...approval.steps,
        buildParticipantContractCallStep({
          contract: "GoalStakeVault",
          functionName: "depositCobuild",
          label: "Deposit cobuild stake",
          to: stakeVaultAddress,
          abi: GOAL_STAKE_VAULT_ABI,
          args: [amount],
        }),
      ],
      expectedEvents: ["CobuildStaked"],
    }),
  });
}

export async function executeStakePrepareUnderwriterWithdrawalCommand(
  input: StakePrepareUnderwriterWithdrawalCommandInput,
  deps: CliDeps
): Promise<ParticipantPlanCommandOutput> {
  const stakeVaultAddress = normalizeEvmAddress(
    requireString(input.vault, STAKE_PREPARE_UNDERWRITER_WITHDRAWAL_USAGE, "--vault"),
    "stakeVaultAddress"
  );
  const maxBudgets = normalizeProtocolBigInt(
    requireBigintLike(
      input.maxBudgets,
      STAKE_PREPARE_UNDERWRITER_WITHDRAWAL_USAGE,
      "--max-budgets"
    ),
    "maxBudgets"
  );

  return executeParticipantProtocolPlan({
    deps,
    input,
    plan: buildStakePlan({
      action: "stake.prepare-underwriter-withdrawal",
      summary: `Prepare underwriter withdrawal batches on stake vault ${stakeVaultAddress}.`,
      steps: [
        buildParticipantContractCallStep({
          contract: "GoalStakeVault",
          functionName: "prepareUnderwriterWithdrawal",
          label: "Prepare underwriter withdrawal",
          to: stakeVaultAddress,
          abi: GOAL_STAKE_VAULT_ABI,
          args: [maxBudgets],
        }),
      ],
      expectedEvents: ["UnderwriterWithdrawalPrepared"],
    }),
  });
}

export async function executeStakeWithdrawGoalCommand(
  input: StakeWithdrawCommandInput,
  deps: CliDeps
): Promise<ParticipantPlanCommandOutput> {
  const stakeVaultAddress = normalizeEvmAddress(
    requireString(input.vault, STAKE_WITHDRAW_GOAL_USAGE, "--vault"),
    "stakeVaultAddress"
  );
  const recipient = normalizeEvmAddress(
    requireString(input.recipient, STAKE_WITHDRAW_GOAL_USAGE, "--recipient"),
    "recipient"
  );
  const amount = normalizeProtocolBigInt(
    requireBigintLike(input.amount, STAKE_WITHDRAW_GOAL_USAGE, "--amount"),
    "amount"
  );

  return executeParticipantProtocolPlan({
    deps,
    input,
    plan: buildStakePlan({
      action: "stake.withdraw-goal",
      summary: `Withdraw goal stake from vault ${stakeVaultAddress} to ${recipient}.`,
      steps: [
        buildParticipantContractCallStep({
          contract: "GoalStakeVault",
          functionName: "withdrawGoal",
          label: "Withdraw goal stake",
          to: stakeVaultAddress,
          abi: GOAL_STAKE_VAULT_ABI,
          args: [amount, recipient],
        }),
      ],
      expectedEvents: ["GoalWithdrawn"],
    }),
  });
}

export async function executeStakeWithdrawCobuildCommand(
  input: StakeWithdrawCommandInput,
  deps: CliDeps
): Promise<ParticipantPlanCommandOutput> {
  const stakeVaultAddress = normalizeEvmAddress(
    requireString(input.vault, STAKE_WITHDRAW_COBUILD_USAGE, "--vault"),
    "stakeVaultAddress"
  );
  const recipient = normalizeEvmAddress(
    requireString(input.recipient, STAKE_WITHDRAW_COBUILD_USAGE, "--recipient"),
    "recipient"
  );
  const amount = normalizeProtocolBigInt(
    requireBigintLike(input.amount, STAKE_WITHDRAW_COBUILD_USAGE, "--amount"),
    "amount"
  );

  return executeParticipantProtocolPlan({
    deps,
    input,
    plan: buildStakePlan({
      action: "stake.withdraw-cobuild",
      summary: `Withdraw cobuild stake from vault ${stakeVaultAddress} to ${recipient}.`,
      steps: [
        buildParticipantContractCallStep({
          contract: "GoalStakeVault",
          functionName: "withdrawCobuild",
          label: "Withdraw cobuild stake",
          to: stakeVaultAddress,
          abi: GOAL_STAKE_VAULT_ABI,
          args: [amount, recipient],
        }),
      ],
      expectedEvents: ["CobuildWithdrawn"],
    }),
  });
}

export async function executePremiumCheckpointCommand(
  input: PremiumCheckpointCommandInput,
  deps: CliDeps
): Promise<ParticipantPlanCommandOutput> {
  const escrow = normalizeEvmAddress(
    requireString(input.escrow, PREMIUM_CHECKPOINT_USAGE, "--escrow"),
    "premiumEscrowAddress"
  );
  const account = normalizeEvmAddress(
    requireString(input.account, PREMIUM_CHECKPOINT_USAGE, "--account"),
    "account"
  );

  return executeParticipantProtocolPlan({
    deps,
    input,
    plan: buildPremiumPlan({
      action: "premium.checkpoint",
      summary: `Checkpoint premium state for ${account} on escrow ${escrow}.`,
      steps: [
        buildParticipantContractCallStep({
          contract: "PremiumEscrow",
          functionName: "checkpoint",
          label: "Checkpoint premium state",
          to: escrow,
          abi: PREMIUM_ESCROW_ABI,
          args: [account],
        }),
      ],
      expectedEvents: ["AccountCheckpointed"],
    }),
  });
}

export async function executePremiumClaimCommand(
  input: PremiumClaimCommandInput,
  deps: CliDeps
): Promise<ParticipantPlanCommandOutput> {
  const escrow = normalizeEvmAddress(
    requireString(input.escrow, PREMIUM_CLAIM_USAGE, "--escrow"),
    "premiumEscrowAddress"
  );
  const recipient = normalizeEvmAddress(
    requireString(input.recipient, PREMIUM_CLAIM_USAGE, "--recipient"),
    "recipient"
  );

  return executeParticipantProtocolPlan({
    deps,
    input,
    plan: buildPremiumPlan({
      action: "premium.claim",
      summary: `Claim premium from escrow ${escrow} to ${recipient}.`,
      steps: [
        buildParticipantContractCallStep({
          contract: "PremiumEscrow",
          functionName: "claim",
          label: "Claim premium",
          to: escrow,
          abi: PREMIUM_ESCROW_ABI,
          args: [recipient],
        }),
      ],
      expectedEvents: ["Claimed"],
    }),
  });
}
