import { normalizeEvmAddress } from "./shared.js";
import { executeCanonicalToolOnly } from "./tool-execution.js";
import type { CliDeps } from "../types.js";
import { normalizeKeyedRemoteToolResponse } from "./remote-tool.js";

const VOTE_STATUS_USAGE = "Usage: cli vote status <identifier> [--juror <address>]";
const VOTE_STATUS_CANONICAL_TOOL_NAMES = [
  "get-dispute",
  "getDispute",
  "vote.status",
  "dispute.inspect",
];

export interface VoteStatusCommandInput {
  identifier?: string;
  juror?: string;
}

export interface VoteStatusCommandOutput extends Record<string, unknown> {
  dispute: unknown;
  ok?: boolean;
  untrusted: true;
  source: "remote_tool";
  warnings: string[];
}

export async function executeVoteStatusCommand(
  input: VoteStatusCommandInput,
  deps: CliDeps
): Promise<VoteStatusCommandOutput> {
  const identifier = input.identifier?.trim() ?? "";
  if (!identifier) {
    throw new Error(VOTE_STATUS_USAGE);
  }

  const juror = input.juror?.trim();
  if (input.juror !== undefined && !juror) {
    throw new Error("--juror cannot be empty.");
  }
  const response = await executeCanonicalToolOnly(deps, {
    canonicalToolNames: VOTE_STATUS_CANONICAL_TOOL_NAMES,
    input: {
      identifier,
      ...(juror ? { juror: normalizeEvmAddress(juror, "--juror") } : {}),
    },
  });

  return normalizeKeyedRemoteToolResponse(response, "dispute") as VoteStatusCommandOutput;
}
