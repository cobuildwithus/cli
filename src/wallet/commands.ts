import { readConfig } from "../config.js";
import {
  getX402WalletPayerMetadata,
  printX402FundingHints,
  runX402InitWorkflow,
} from "../farcaster/payer.js";
import type { CliDeps } from "../types.js";
import { resolveAgentKey } from "../commands/shared.js";
import {
  requireStoredWalletConfig,
  resolveConfiguredWalletContext,
} from "./payer-config.js";

export interface WalletInitCommandInput {
  agent?: string;
  mode?: string;
  privateKeyStdin?: boolean;
  privateKeyFile?: string;
  noPrompt?: boolean;
}

export interface WalletStatusCommandInput {
  agent?: string;
}

export async function executeWalletInitCommand(
  input: WalletInitCommandInput,
  deps: CliDeps
): Promise<Record<string, unknown>> {
  const current = readConfig(deps);
  const agentKey = resolveAgentKey(input.agent, current.agent);
  const walletMetadata = getX402WalletPayerMetadata();
  const setup = await runX402InitWorkflow({
    deps,
    currentConfig: current,
    agentKey,
    modeArg: input.mode,
    noPrompt: input.noPrompt ?? false,
    privateKeyStdin: input.privateKeyStdin ?? false,
    privateKeyFile: input.privateKeyFile,
  });
  printX402FundingHints(deps, setup);

  return {
    ok: true,
    agentKey,
    walletConfig: {
      mode: setup.mode,
      walletAddress: setup.payerAddress,
      network: walletMetadata.network,
      token: walletMetadata.token,
      costPerPaidCallMicroUsdc: walletMetadata.costPerPaidCallMicroUsdc,
    },
  };
}

export async function executeWalletStatusCommand(
  input: WalletStatusCommandInput,
  deps: CliDeps
): Promise<Record<string, unknown>> {
  const current = readConfig(deps);
  const agentKey = resolveAgentKey(input.agent, current.agent);
  const walletMetadata = getX402WalletPayerMetadata();
  const walletConfig = requireStoredWalletConfig({
    deps,
    agentKey,
  });

  const walletContext =
    walletConfig.mode === "local"
      ? await resolveConfiguredWalletContext({
          deps,
          currentConfig: current,
          agentKey,
        })
      : await (async () => {
          try {
            return await resolveConfiguredWalletContext({
              deps,
              currentConfig: current,
              agentKey,
              refreshHostedAddress: true,
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(
              `Hosted wallet address is unknown and could not be fetched from backend wallet endpoint: ${message}`
            );
          }
        })();

  if (walletContext.walletMode === "hosted" && !walletContext.payerAddress) {
    throw new Error(
      "Hosted wallet address is unknown and could not be fetched from backend wallet endpoint: backend returned no address."
    );
  }

  return {
    ok: true,
    agentKey,
    walletConfig: {
      mode: walletContext.walletConfig.mode,
      walletAddress: walletContext.payerAddress,
      network: walletContext.walletConfig.network,
      token: walletContext.walletConfig.token,
      costPerPaidCallMicroUsdc: walletMetadata.costPerPaidCallMicroUsdc,
    },
  };
}
