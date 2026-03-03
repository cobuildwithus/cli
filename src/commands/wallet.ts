import { readConfig } from "../config.js";
import { apiPost } from "../transport.js";
import type { CliDeps } from "../types.js";
import { resolveAgentKey } from "./shared.js";
export {
  executeWalletPayerInitCommand,
  executeWalletPayerStatusCommand,
} from "./farcaster.js";
export type {
  WalletPayerInitCommandInput,
  WalletPayerStatusCommandInput,
} from "./farcaster.js";

export interface WalletCommandInput {
  network?: string;
  agent?: string;
}

export async function executeWalletCommand(input: WalletCommandInput, deps: CliDeps): Promise<unknown> {
  const current = readConfig(deps);
  return await apiPost(deps, "/api/cli/wallet", {
    defaultNetwork: input.network,
    agentKey: resolveAgentKey(input.agent, current.agent),
  });
}
