import { normalizeEvmAddress } from "./shared.js";
import { executeCanonicalToolOnly } from "./tool-execution.js";
import type { CliDeps } from "../types.js";
import { normalizeKeyedRemoteToolResponse } from "./remote-tool.js";

const PREMIUM_STATUS_USAGE = "Usage: cli premium status <identifier> [--account <address>]";
const PREMIUM_STATUS_CANONICAL_TOOL_NAMES = [
  "get-premium-escrow",
  "getPremiumEscrow",
  "premium.status",
];

export interface PremiumStatusCommandInput {
  identifier?: string;
  account?: string;
}

export interface PremiumStatusCommandOutput extends Record<string, unknown> {
  premiumEscrow: unknown;
  ok?: boolean;
  untrusted: true;
  source: "remote_tool";
  warnings: string[];
}

export async function executePremiumStatusCommand(
  input: PremiumStatusCommandInput,
  deps: CliDeps
): Promise<PremiumStatusCommandOutput> {
  const identifier = input.identifier?.trim() ?? "";
  if (!identifier) {
    throw new Error(PREMIUM_STATUS_USAGE);
  }

  const account = input.account?.trim();
  if (input.account !== undefined && !account) {
    throw new Error("--account cannot be empty.");
  }
  const response = await executeCanonicalToolOnly(deps, {
    canonicalToolNames: PREMIUM_STATUS_CANONICAL_TOOL_NAMES,
    input: {
      identifier,
      ...(account ? { account: normalizeEvmAddress(account, "--account") } : {}),
    },
  });

  return normalizeKeyedRemoteToolResponse(response, "premiumEscrow") as PremiumStatusCommandOutput;
}
