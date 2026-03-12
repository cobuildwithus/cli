import {
  buildCobuildStakeDepositPlan,
  buildJurorDelegateUpdatePlan,
  buildJurorExitFinalizationPlan,
  buildJurorExitRequestPlan,
  buildJurorOptInPlan,
  buildCobuildStakeWithdrawalPlan,
  buildGoalStakeDepositPlan,
  buildGoalStakeWithdrawalPlan,
  buildPremiumCheckpointPlan,
  buildPremiumClaimPlan,
  buildUnderwriterWithdrawalPreparationPlan,
} from "@cobuild/wire";
import type { CliDeps } from "../types.js";
import { resolveNetwork } from "./shared.js";
import {
  executeParticipantProtocolPlan,
  type ParticipantPlanCommandInput,
  type ParticipantPlanCommandOutput,
} from "./protocol-participant-runtime.js";

const STAKE_DEPOSIT_GOAL_USAGE =
  "Usage: cli stake deposit-goal --vault <address> --token <address> --amount <n> [--approval-mode <auto|force|skip>] [--current-allowance <n>] [--approval-amount <n>] [--network <network>] [--agent <key>] [--idempotency-key <key>] [--dry-run]";
const STAKE_DEPOSIT_COBUILD_USAGE =
  "Usage: cli stake deposit-cobuild --vault <address> --token <address> --amount <n> [--approval-mode <auto|force|skip>] [--current-allowance <n>] [--approval-amount <n>] [--network <network>] [--agent <key>] [--idempotency-key <key>] [--dry-run]";
const STAKE_PREPARE_UNDERWRITER_WITHDRAWAL_USAGE =
  "Usage: cli stake prepare-underwriter-withdrawal --vault <address> --max-budgets <n> [--network <network>] [--agent <key>] [--idempotency-key <key>] [--dry-run]";
const STAKE_OPT_IN_JUROR_USAGE =
  "Usage: cli stake opt-in-juror --vault <address> --token <address> --goal-amount <n> --delegate <address> [--approval-mode <auto|force|skip>] [--current-allowance <n>] [--approval-amount <n>] [--network <network>] [--agent <key>] [--idempotency-key <key>] [--dry-run]";
const STAKE_REQUEST_JUROR_EXIT_USAGE =
  "Usage: cli stake request-juror-exit --vault <address> --goal-amount <n> [--network <network>] [--agent <key>] [--idempotency-key <key>] [--dry-run]";
const STAKE_FINALIZE_JUROR_EXIT_USAGE =
  "Usage: cli stake finalize-juror-exit --vault <address> [--network <network>] [--agent <key>] [--idempotency-key <key>] [--dry-run]";
const STAKE_SET_JUROR_DELEGATE_USAGE =
  "Usage: cli stake set-juror-delegate --vault <address> --delegate <address> [--network <network>] [--agent <key>] [--idempotency-key <key>] [--dry-run]";
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

export interface StakeOptInJurorCommandInput extends ParticipantPlanCommandInput {
  vault?: string;
  token?: string;
  goalAmount?: string | number | bigint;
  delegate?: string;
  approvalMode?: "auto" | "force" | "skip";
  currentAllowance?: string | number | bigint;
  approvalAmount?: string | number | bigint;
}

export interface StakeRequestJurorExitCommandInput extends ParticipantPlanCommandInput {
  vault?: string;
  goalAmount?: string | number | bigint;
}

export interface StakeFinalizeJurorExitCommandInput extends ParticipantPlanCommandInput {
  vault?: string;
}

export interface StakeSetJurorDelegateCommandInput extends ParticipantPlanCommandInput {
  vault?: string;
  delegate?: string;
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

type ParticipantProtocolPlan = Parameters<typeof executeParticipantProtocolPlan>[0]["plan"];

interface StakeApprovalInput {
  approvalMode?: "auto" | "force" | "skip";
  currentAllowance?: string | number | bigint;
  approvalAmount?: string | number | bigint;
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

function resolvePlanNetwork(input: ParticipantPlanCommandInput, deps: Pick<CliDeps, "env">): string {
  return resolveNetwork(input.network, deps);
}

function pickApprovalOverrides(input: StakeApprovalInput): Partial<StakeApprovalInput> {
  return {
    ...(input.approvalMode ? { approvalMode: input.approvalMode } : {}),
    ...(input.currentAllowance !== undefined ? { currentAllowance: input.currentAllowance } : {}),
    ...(input.approvalAmount !== undefined ? { approvalAmount: input.approvalAmount } : {}),
  };
}

function executeParticipantFamilyPlan(
  family: "stake" | "premium",
  input: ParticipantPlanCommandInput,
  deps: CliDeps,
  plan: ParticipantProtocolPlan
): Promise<ParticipantPlanCommandOutput> {
  return executeParticipantProtocolPlan({
    deps,
    family,
    input,
    plan,
  });
}

export async function executeStakeDepositGoalCommand(
  input: StakeDepositCommandInput,
  deps: CliDeps
): Promise<ParticipantPlanCommandOutput> {
  const plan = buildGoalStakeDepositPlan({
    network: resolvePlanNetwork(input, deps),
    stakeVaultAddress: requireString(input.vault, STAKE_DEPOSIT_GOAL_USAGE, "--vault"),
    goalTokenAddress: requireString(input.token, STAKE_DEPOSIT_GOAL_USAGE, "--token"),
    amount: requireBigintLike(input.amount, STAKE_DEPOSIT_GOAL_USAGE, "--amount"),
    ...pickApprovalOverrides(input),
  });

  return executeParticipantFamilyPlan("stake", input, deps, plan);
}

export async function executeStakeDepositCobuildCommand(
  input: StakeDepositCommandInput,
  deps: CliDeps
): Promise<ParticipantPlanCommandOutput> {
  const plan = buildCobuildStakeDepositPlan({
    network: resolvePlanNetwork(input, deps),
    stakeVaultAddress: requireString(input.vault, STAKE_DEPOSIT_COBUILD_USAGE, "--vault"),
    cobuildTokenAddress: requireString(input.token, STAKE_DEPOSIT_COBUILD_USAGE, "--token"),
    amount: requireBigintLike(input.amount, STAKE_DEPOSIT_COBUILD_USAGE, "--amount"),
    ...pickApprovalOverrides(input),
  });

  return executeParticipantFamilyPlan("stake", input, deps, plan);
}

export async function executeStakePrepareUnderwriterWithdrawalCommand(
  input: StakePrepareUnderwriterWithdrawalCommandInput,
  deps: CliDeps
): Promise<ParticipantPlanCommandOutput> {
  const plan = buildUnderwriterWithdrawalPreparationPlan({
    network: resolvePlanNetwork(input, deps),
    stakeVaultAddress: requireString(input.vault, STAKE_PREPARE_UNDERWRITER_WITHDRAWAL_USAGE, "--vault"),
    maxBudgets: requireBigintLike(
      input.maxBudgets,
      STAKE_PREPARE_UNDERWRITER_WITHDRAWAL_USAGE,
      "--max-budgets"
    ),
  });

  return executeParticipantFamilyPlan("stake", input, deps, plan);
}

export async function executeStakeOptInJurorCommand(
  input: StakeOptInJurorCommandInput,
  deps: CliDeps
): Promise<ParticipantPlanCommandOutput> {
  const plan = buildJurorOptInPlan({
    network: resolvePlanNetwork(input, deps),
    stakeVaultAddress: requireString(input.vault, STAKE_OPT_IN_JUROR_USAGE, "--vault"),
    goalTokenAddress: requireString(input.token, STAKE_OPT_IN_JUROR_USAGE, "--token"),
    goalAmount: requireBigintLike(input.goalAmount, STAKE_OPT_IN_JUROR_USAGE, "--goal-amount"),
    delegate: requireString(input.delegate, STAKE_OPT_IN_JUROR_USAGE, "--delegate"),
    ...pickApprovalOverrides(input),
  });

  return executeParticipantFamilyPlan("stake", input, deps, plan);
}

export async function executeStakeRequestJurorExitCommand(
  input: StakeRequestJurorExitCommandInput,
  deps: CliDeps
): Promise<ParticipantPlanCommandOutput> {
  const plan = buildJurorExitRequestPlan({
    network: resolvePlanNetwork(input, deps),
    stakeVaultAddress: requireString(input.vault, STAKE_REQUEST_JUROR_EXIT_USAGE, "--vault"),
    goalAmount: requireBigintLike(input.goalAmount, STAKE_REQUEST_JUROR_EXIT_USAGE, "--goal-amount"),
  });

  return executeParticipantFamilyPlan("stake", input, deps, plan);
}

export async function executeStakeFinalizeJurorExitCommand(
  input: StakeFinalizeJurorExitCommandInput,
  deps: CliDeps
): Promise<ParticipantPlanCommandOutput> {
  const plan = buildJurorExitFinalizationPlan({
    network: resolvePlanNetwork(input, deps),
    stakeVaultAddress: requireString(input.vault, STAKE_FINALIZE_JUROR_EXIT_USAGE, "--vault"),
  });

  return executeParticipantFamilyPlan("stake", input, deps, plan);
}

export async function executeStakeSetJurorDelegateCommand(
  input: StakeSetJurorDelegateCommandInput,
  deps: CliDeps
): Promise<ParticipantPlanCommandOutput> {
  const plan = buildJurorDelegateUpdatePlan({
    network: resolvePlanNetwork(input, deps),
    stakeVaultAddress: requireString(input.vault, STAKE_SET_JUROR_DELEGATE_USAGE, "--vault"),
    delegate: requireString(input.delegate, STAKE_SET_JUROR_DELEGATE_USAGE, "--delegate"),
  });

  return executeParticipantFamilyPlan("stake", input, deps, plan);
}

export async function executeStakeWithdrawGoalCommand(
  input: StakeWithdrawCommandInput,
  deps: CliDeps
): Promise<ParticipantPlanCommandOutput> {
  const plan = buildGoalStakeWithdrawalPlan({
    network: resolvePlanNetwork(input, deps),
    stakeVaultAddress: requireString(input.vault, STAKE_WITHDRAW_GOAL_USAGE, "--vault"),
    amount: requireBigintLike(input.amount, STAKE_WITHDRAW_GOAL_USAGE, "--amount"),
    recipient: requireString(input.recipient, STAKE_WITHDRAW_GOAL_USAGE, "--recipient"),
  });

  return executeParticipantFamilyPlan("stake", input, deps, plan);
}

export async function executeStakeWithdrawCobuildCommand(
  input: StakeWithdrawCommandInput,
  deps: CliDeps
): Promise<ParticipantPlanCommandOutput> {
  const plan = buildCobuildStakeWithdrawalPlan({
    network: resolvePlanNetwork(input, deps),
    stakeVaultAddress: requireString(input.vault, STAKE_WITHDRAW_COBUILD_USAGE, "--vault"),
    amount: requireBigintLike(input.amount, STAKE_WITHDRAW_COBUILD_USAGE, "--amount"),
    recipient: requireString(input.recipient, STAKE_WITHDRAW_COBUILD_USAGE, "--recipient"),
  });

  return executeParticipantFamilyPlan("stake", input, deps, plan);
}

export async function executePremiumCheckpointCommand(
  input: PremiumCheckpointCommandInput,
  deps: CliDeps
): Promise<ParticipantPlanCommandOutput> {
  const plan = buildPremiumCheckpointPlan({
    network: resolvePlanNetwork(input, deps),
    premiumEscrowAddress: requireString(input.escrow, PREMIUM_CHECKPOINT_USAGE, "--escrow"),
    account: requireString(input.account, PREMIUM_CHECKPOINT_USAGE, "--account"),
  });

  return executeParticipantFamilyPlan("premium", input, deps, plan);
}

export async function executePremiumClaimCommand(
  input: PremiumClaimCommandInput,
  deps: CliDeps
): Promise<ParticipantPlanCommandOutput> {
  const plan = buildPremiumClaimPlan({
    network: resolvePlanNetwork(input, deps),
    premiumEscrowAddress: requireString(input.escrow, PREMIUM_CLAIM_USAGE, "--escrow"),
    recipient: requireString(input.recipient, PREMIUM_CLAIM_USAGE, "--recipient"),
  });

  return executeParticipantFamilyPlan("premium", input, deps, plan);
}
