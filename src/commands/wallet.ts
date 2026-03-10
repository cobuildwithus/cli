import { readConfig } from "../config.js";
import { asRecord, apiPost } from "../transport.js";
import type { CliDeps } from "../types.js";
import { resolveAgentKey } from "./shared.js";
import { resolveNetwork } from "./shared.js";
import {
  getX402WalletPayerCostMicroUsdc,
} from "../farcaster/payer.js";
import { buildLocalWalletSummary } from "../wallet/local-exec.js";
import { executeWithConfiguredWallet } from "../wallet/payer-config.js";
export {
  executeWalletInitCommand,
  executeWalletStatusCommand,
} from "../wallet/commands.js";
export type {
  WalletInitCommandInput,
  WalletStatusCommandInput,
} from "../wallet/commands.js";

export interface WalletCommandInput {
  network?: string;
  agent?: string;
}

export async function executeWalletCommand(input: WalletCommandInput, deps: CliDeps): Promise<unknown> {
  const current = readConfig(deps);
  const agentKey = resolveAgentKey(input.agent, current.agent);
  const network = resolveNetwork(input.network, deps);
  const toWalletConfigOutput = (walletConfig: {
    mode: "hosted" | "local";
    payerAddress: string | null;
    network: string;
    token: string;
  }) => ({
    mode: walletConfig.mode,
    walletAddress: walletConfig.payerAddress,
    network: walletConfig.network,
    token: walletConfig.token,
    costPerPaidCallMicroUsdc: getX402WalletPayerCostMicroUsdc(),
  });

  return executeWithConfiguredWallet({
    deps,
    currentConfig: current,
    agentKey,
    onLocal: async ({ walletConfig, privateKeyHex }) => ({
      ...buildLocalWalletSummary({
        agentKey,
        network,
        privateKeyHex,
      }),
      walletConfig: toWalletConfigOutput(walletConfig),
    }),
    onHosted: async (walletConfig) => {
      const hosted = await apiPost(deps, "/api/cli/wallet", {
        defaultNetwork: network,
        agentKey,
      });
      const hostedObject = asRecord(hosted);
      return {
        ...hostedObject,
        walletConfig: toWalletConfigOutput(walletConfig),
      };
    },
  });
}
