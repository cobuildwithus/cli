import type { CliConfig, CliDeps } from "../types.js";
import {
  readStoredX402PayerConfig,
  resolveLocalPayerPrivateKey,
} from "../farcaster/payer.js";
import type { HexString, StoredX402PayerConfig } from "../farcaster/types.js";

export const MISSING_WALLET_CONFIG_ERROR =
  "No wallet is configured for this agent. Run `cli wallet init --mode hosted|local-generate|local-key`.";

export function requireStoredWalletConfig(params: {
  deps: Pick<CliDeps, "fs" | "homedir">;
  agentKey: string;
}): StoredX402PayerConfig {
  const walletConfig = readStoredX402PayerConfig({
    deps: params.deps,
    agentKey: params.agentKey,
  });
  if (!walletConfig) {
    throw new Error(MISSING_WALLET_CONFIG_ERROR);
  }
  return walletConfig;
}

export async function executeWithConfiguredWallet<T>(params: {
  deps: Pick<CliDeps, "fs" | "homedir" | "env">;
  currentConfig: CliConfig;
  agentKey: string;
  onHosted: (walletConfig: StoredX402PayerConfig) => Promise<T>;
  onLocal: (context: { walletConfig: StoredX402PayerConfig; privateKeyHex: HexString }) => Promise<T>;
}): Promise<T> {
  const walletConfig = requireStoredWalletConfig({
    deps: params.deps,
    agentKey: params.agentKey,
  });

  if (walletConfig.mode === "local") {
    const privateKeyHex = resolveLocalPayerPrivateKey({
      deps: params.deps,
      currentConfig: params.currentConfig,
      payerConfig: walletConfig,
    });
    return params.onLocal({
      walletConfig,
      privateKeyHex,
    });
  }

  return params.onHosted(walletConfig);
}
