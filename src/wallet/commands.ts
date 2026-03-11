import { privateKeyToAccount } from "viem/accounts";
import { readConfig } from "../config.js";
import {
  fetchHostedPayerAddress,
  getX402WalletPayerMetadata,
  printX402FundingHints,
  readStoredX402PayerConfig,
  resolveLocalPayerPrivateKey,
  runX402InitWorkflow,
  writeStoredX402PayerConfig,
} from "../farcaster/payer.js";
import type { CliDeps } from "../types.js";
import { resolveAgentKey } from "../commands/shared.js";

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
  const stored = readStoredX402PayerConfig({
    deps,
    agentKey,
  });
  if (!stored) {
    throw new Error(
      "No wallet is configured for this agent. Run `cli wallet init --mode hosted|local-generate|local-key`."
    );
  }

  let payerAddress = stored.payerAddress;
  if (stored.mode === "local") {
    const privateKeyHex = resolveLocalPayerPrivateKey({
      deps,
      currentConfig: current,
      payerConfig: stored,
    });
    payerAddress = privateKeyToAccount(privateKeyHex).address;
  } else if (!payerAddress) {
    try {
      payerAddress = await fetchHostedPayerAddress({
        deps,
        agentKey,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Hosted wallet address is unknown and could not be fetched from backend wallet endpoint: ${message}`
      );
    }
  }

  if (payerAddress !== stored.payerAddress) {
    writeStoredX402PayerConfig({
      deps,
      agentKey,
      config: {
        ...stored,
        payerAddress,
      },
    });
  }

  return {
    ok: true,
    agentKey,
    walletConfig: {
      mode: stored.mode,
      walletAddress: payerAddress,
      network: stored.network,
      token: stored.token,
      costPerPaidCallMicroUsdc: walletMetadata.costPerPaidCallMicroUsdc,
    },
  };
}
