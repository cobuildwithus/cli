import { buildCommunityTerminalAddToBalancePlan } from "@cobuild/wire";
import type { CliDeps } from "../types.js";
import {
  executeTerminalFundingPlan,
  readOptionalBigintLikeFromInputJson,
  readOptionalStringFromInputJson,
  readRequiredBigintLikeFromInputJson,
  readRequiredJsonCommandInput,
  type TerminalFundingCommandOutput,
  type TerminalFundingJsonCommandInput,
} from "./terminal-funding-shared.js";

const COMMUNITY_ADD_TO_BALANCE_USAGE =
  "Usage: cli community add-to-balance --input-json <json>|--input-file <path>|--input-stdin [--dry-run]";

export interface CommunityAddToBalanceCommandInput extends TerminalFundingJsonCommandInput {}

async function resolveCommunityAddToBalanceInput(
  input: CommunityAddToBalanceCommandInput,
  deps: Pick<CliDeps, "fs" | "readStdin">
): Promise<{
  terminal?: string;
  projectId: string | number | bigint;
  token?: string;
  amount: string | number | bigint;
  memo?: string;
  metadata?: string;
  network?: string;
  agent?: string;
  idempotencyKey?: string;
}> {
  const payload = await readRequiredJsonCommandInput(input, deps, {
    usage: COMMUNITY_ADD_TO_BALANCE_USAGE,
    valueLabel: "community add-to-balance input",
  });

  return {
    terminal: readOptionalStringFromInputJson(
      payload,
      "terminal",
      "community add-to-balance input"
    ),
    projectId: readRequiredBigintLikeFromInputJson(
      payload,
      "projectId",
      "community add-to-balance input"
    ),
    token: readOptionalStringFromInputJson(payload, "token", "community add-to-balance input"),
    amount: readRequiredBigintLikeFromInputJson(payload, "amount", "community add-to-balance input"),
    memo: readOptionalStringFromInputJson(payload, "memo", "community add-to-balance input"),
    metadata: readOptionalStringFromInputJson(
      payload,
      "metadata",
      "community add-to-balance input"
    ),
    network: readOptionalStringFromInputJson(payload, "network", "community add-to-balance input"),
    agent: readOptionalStringFromInputJson(payload, "agent", "community add-to-balance input"),
    idempotencyKey: readOptionalStringFromInputJson(
      payload,
      "idempotencyKey",
      "community add-to-balance input"
    ),
  };
}

export async function executeCommunityAddToBalanceCommand(
  input: CommunityAddToBalanceCommandInput,
  deps: CliDeps
): Promise<TerminalFundingCommandOutput<"community">> {
  const resolved = await resolveCommunityAddToBalanceInput(input, deps);
  const plan = buildCommunityTerminalAddToBalancePlan({
    projectId: resolved.projectId,
    amount: resolved.amount,
    ...(resolved.terminal !== undefined ? { terminal: resolved.terminal } : {}),
    ...(resolved.token !== undefined ? { token: resolved.token } : {}),
    ...(resolved.memo !== undefined ? { memo: resolved.memo } : {}),
    ...(resolved.metadata !== undefined ? { metadata: resolved.metadata } : {}),
    ...(resolved.network !== undefined ? { network: resolved.network } : {}),
  });

  return executeTerminalFundingPlan({
    deps,
    family: "community",
    input: {
      agent: resolved.agent,
      dryRun: input.dryRun,
      idempotencyKey: resolved.idempotencyKey,
      network: resolved.network,
    },
    plan,
  });
}
