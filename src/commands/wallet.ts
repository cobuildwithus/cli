import { readConfig } from "../config.js";
import { asRecord, apiPost } from "../transport.js";
import type { CliDeps } from "../types.js";
import { resolveAgentKey } from "./shared.js";
import { resolveNetwork } from "./shared.js";
import {
  getX402WalletPayerCostMicroUsdc,
  readStoredX402PayerConfig,
  resolveLocalPayerPrivateKey,
} from "../farcaster/payer.js";
import { buildLocalWalletSummary } from "../wallet/local-exec.js";
export {
  executeWalletInitCommand,
  executeWalletStatusCommand,
} from "./farcaster.js";
export type {
  WalletInitCommandInput,
  WalletStatusCommandInput,
} from "./farcaster.js";

export interface WalletCommandInput {
  network?: string;
  agent?: string;
}

export async function executeWalletCommand(input: WalletCommandInput, deps: CliDeps): Promise<unknown> {
  const current = readConfig(deps);
  const agentKey = resolveAgentKey(input.agent, current.agent);
  const network = resolveNetwork(input.network, deps);
  const walletConfig = readStoredX402PayerConfig({
    deps,
    agentKey,
  });
  if (!walletConfig) {
    throw new Error(
      "No wallet is configured for this agent. Run `cli wallet init --mode hosted|local-generate|local-key`."
    );
  }

  const walletConfigOutput = {
    mode: walletConfig.mode,
    walletAddress: walletConfig.payerAddress,
    network: walletConfig.network,
    token: walletConfig.token,
    costPerPaidCallMicroUsdc: getX402WalletPayerCostMicroUsdc(),
  };

  if (walletConfig.mode === "local") {
    const privateKeyHex = resolveLocalPayerPrivateKey({
      deps,
      currentConfig: current,
      payerConfig: walletConfig,
    });
    return {
      ...buildLocalWalletSummary({
        agentKey,
        network,
        privateKeyHex,
      }),
      walletConfig: walletConfigOutput,
    };
  }

  const hosted = await apiPost(deps, "/api/cli/wallet", {
    defaultNetwork: input.network,
    agentKey,
  });
  const hostedObject = asRecord(hosted);
  if (!hostedObject) {
    return {
      result: hosted,
      walletConfig: walletConfigOutput,
    };
  }

  return {
    ...hostedObject,
    walletConfig: walletConfigOutput,
  };
}
