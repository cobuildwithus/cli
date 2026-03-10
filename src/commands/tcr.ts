import { executeCanonicalToolOnly } from "./tool-execution.js";
import type { CliDeps } from "../types.js";
import { normalizeKeyedRemoteToolResponse } from "./remote-tool.js";

const TCR_INSPECT_USAGE = "Usage: cli tcr inspect <identifier>";
const TCR_CANONICAL_TOOL_NAMES = ["get-tcr-request", "getTcrRequest", "tcr.inspect"];

export interface TcrInspectCommandInput {
  identifier?: string;
}

export interface TcrInspectCommandOutput extends Record<string, unknown> {
  tcrRequest: unknown;
  ok?: boolean;
  untrusted: true;
  source: "remote_tool";
  warnings: string[];
}

export async function executeTcrInspectCommand(
  input: TcrInspectCommandInput,
  deps: CliDeps
): Promise<TcrInspectCommandOutput> {
  const identifier = input.identifier?.trim() ?? "";
  if (!identifier) {
    throw new Error(TCR_INSPECT_USAGE);
  }

  const response = await executeCanonicalToolOnly(deps, {
    canonicalToolNames: TCR_CANONICAL_TOOL_NAMES,
    input: {
      identifier,
    },
  });

  return normalizeKeyedRemoteToolResponse(response, "tcrRequest") as TcrInspectCommandOutput;
}
