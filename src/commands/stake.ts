import { normalizeEvmAddress } from "./shared.js";
import { executeCanonicalToolOnly } from "./tool-execution.js";
import type { CliDeps } from "../types.js";
import { normalizeKeyedRemoteToolResponse } from "./remote-tool.js";

const STAKE_STATUS_USAGE = "Usage: cli stake status <identifier> <account>";
const STAKE_STATUS_CANONICAL_TOOL_NAMES = [
  "get-stake-position",
  "getStakePosition",
  "stake.status",
];

export interface StakeStatusCommandInput {
  identifier?: string;
  account?: string;
}

export interface StakeStatusCommandOutput extends Record<string, unknown> {
  stakePosition: unknown;
  ok?: boolean;
  untrusted: true;
  source: "remote_tool";
  warnings: string[];
}

export async function executeStakeStatusCommand(
  input: StakeStatusCommandInput,
  deps: CliDeps
): Promise<StakeStatusCommandOutput> {
  const identifier = input.identifier?.trim() ?? "";
  const account = input.account?.trim() ?? "";
  if (!identifier || !account) {
    throw new Error(STAKE_STATUS_USAGE);
  }

  const response = await executeCanonicalToolOnly(deps, {
    canonicalToolNames: STAKE_STATUS_CANONICAL_TOOL_NAMES,
    input: {
      identifier,
      account: normalizeEvmAddress(account, "account"),
    },
  });

  return normalizeKeyedRemoteToolResponse(response, "stakePosition") as StakeStatusCommandOutput;
}
