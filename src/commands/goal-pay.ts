import { buildGoalTerminalPayPlan } from "@cobuild/wire";
import type { CliDeps } from "../types.js";
import {
  executeTerminalFundingPlan,
  readOptionalBigintLikeFromInputJson,
  readOptionalStringFromInputJson,
  readRequiredBigintLikeFromInputJson,
  readRequiredJsonCommandInput,
  readRequiredStringFromInputJson,
  type TerminalFundingCommandOutput,
  type TerminalFundingJsonCommandInput,
} from "./terminal-funding-shared.js";

const GOAL_PAY_USAGE =
  "Usage: cli goal pay --input-json <json>|--input-file <path>|--input-stdin [--dry-run]";

export interface GoalPayCommandInput extends TerminalFundingJsonCommandInput {}

async function resolveGoalPayInput(
  input: GoalPayCommandInput,
  deps: Pick<CliDeps, "fs" | "readStdin">
): Promise<{
  terminal: string;
  projectId: string | number | bigint;
  token?: string;
  amount: string | number | bigint;
  beneficiary: string;
  minReturnedTokens?: string | number | bigint;
  memo?: string;
  metadata?: string;
  network?: string;
  agent?: string;
  idempotencyKey?: string;
}> {
  const payload = await readRequiredJsonCommandInput(input, deps, {
    usage: GOAL_PAY_USAGE,
    valueLabel: "goal pay input",
  });

  return {
    terminal: readRequiredStringFromInputJson(payload, "terminal", "goal pay input"),
    projectId: readRequiredBigintLikeFromInputJson(payload, "projectId", "goal pay input"),
    token: readOptionalStringFromInputJson(payload, "token", "goal pay input"),
    amount: readRequiredBigintLikeFromInputJson(payload, "amount", "goal pay input"),
    beneficiary: readRequiredStringFromInputJson(payload, "beneficiary", "goal pay input"),
    minReturnedTokens: readOptionalBigintLikeFromInputJson(
      payload,
      "minReturnedTokens",
      "goal pay input"
    ),
    memo: readOptionalStringFromInputJson(payload, "memo", "goal pay input"),
    metadata: readOptionalStringFromInputJson(payload, "metadata", "goal pay input"),
    network: readOptionalStringFromInputJson(payload, "network", "goal pay input"),
    agent: readOptionalStringFromInputJson(payload, "agent", "goal pay input"),
    idempotencyKey: readOptionalStringFromInputJson(
      payload,
      "idempotencyKey",
      "goal pay input"
    ),
  };
}

export async function executeGoalPayCommand(
  input: GoalPayCommandInput,
  deps: CliDeps
): Promise<TerminalFundingCommandOutput<"goal">> {
  const resolved = await resolveGoalPayInput(input, deps);
  const plan = buildGoalTerminalPayPlan({
    terminal: resolved.terminal,
    projectId: resolved.projectId,
    token: resolved.token,
    amount: resolved.amount,
    beneficiary: resolved.beneficiary,
    ...(resolved.minReturnedTokens !== undefined
      ? { minReturnedTokens: resolved.minReturnedTokens }
      : {}),
    ...(resolved.memo !== undefined ? { memo: resolved.memo } : {}),
    ...(resolved.metadata !== undefined ? { metadata: resolved.metadata } : {}),
    ...(resolved.network !== undefined ? { network: resolved.network } : {}),
  });

  return executeTerminalFundingPlan({
    deps,
    family: "goal",
    input: {
      agent: resolved.agent,
      dryRun: input.dryRun,
      idempotencyKey: resolved.idempotencyKey,
      network: resolved.network,
    },
    plan,
  });
}
