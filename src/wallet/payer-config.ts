import type { CliConfig, CliDeps } from "../types.js";
import {
  fetchHostedPayerAddress,
  readStoredX402PayerConfig,
  resolveLocalPayerPrivateKey,
  writeStoredX402PayerConfig,
} from "../farcaster/payer.js";
import type { HexString, StoredX402PayerConfig } from "../farcaster/types.js";
import { privateKeyToAccount } from "viem/accounts";

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

export type ConfiguredWalletContext =
  | {
      walletMode: "hosted";
      walletConfig: StoredX402PayerConfig;
      payerAddress: string | null;
    }
  | {
      walletMode: "local";
      walletConfig: StoredX402PayerConfig;
      payerAddress: `0x${string}`;
      privateKeyHex: HexString;
    };

export async function resolveConfiguredWalletContext(params: {
  deps: Pick<CliDeps, "fetch" | "fs" | "homedir" | "env">;
  currentConfig: CliConfig;
  agentKey: string;
  refreshHostedAddress?: boolean;
}): Promise<ConfiguredWalletContext> {
  const walletConfig = requireStoredWalletConfig({
    deps: params.deps,
    agentKey: params.agentKey,
  });
  const resolveWalletConfig = (payerAddress: string | null): StoredX402PayerConfig => {
    if (payerAddress === walletConfig.payerAddress) {
      return walletConfig;
    }

    const nextWalletConfig = {
      ...walletConfig,
      payerAddress,
    };
    writeStoredX402PayerConfig({
      deps: params.deps,
      agentKey: params.agentKey,
      config: nextWalletConfig,
    });

    return nextWalletConfig;
  };

  if (walletConfig.mode === "local") {
    const privateKeyHex = resolveLocalPayerPrivateKey({
      deps: params.deps,
      currentConfig: params.currentConfig,
      payerConfig: walletConfig,
    });
    const payerAddress = privateKeyToAccount(privateKeyHex).address;
    const resolvedWalletConfig = resolveWalletConfig(payerAddress);

    return {
      walletMode: "local",
      walletConfig: resolvedWalletConfig,
      payerAddress,
      privateKeyHex,
    };
  }

  let payerAddress = walletConfig.payerAddress;
  if (!payerAddress && params.refreshHostedAddress === true) {
    payerAddress = await fetchHostedPayerAddress({
      deps: params.deps,
      agentKey: params.agentKey,
    });
  }
  const resolvedWalletConfig = resolveWalletConfig(payerAddress);

  return {
    walletMode: "hosted",
    walletConfig: resolvedWalletConfig,
    payerAddress,
  };
}

export async function executeWithConfiguredWallet<T>(params: {
  deps: Pick<CliDeps, "fetch" | "fs" | "homedir" | "env">;
  currentConfig: CliConfig;
  agentKey: string;
  refreshHostedAddress?: boolean;
  onHosted: (walletConfig: StoredX402PayerConfig) => Promise<T>;
  onLocal: (context: { walletConfig: StoredX402PayerConfig; privateKeyHex: HexString }) => Promise<T>;
}): Promise<T> {
  const walletContext = await resolveConfiguredWalletContext({
    deps: params.deps,
    currentConfig: params.currentConfig,
    agentKey: params.agentKey,
    refreshHostedAddress: params.refreshHostedAddress,
  });

  if (walletContext.walletMode === "local") {
    return params.onLocal({
      walletConfig: walletContext.walletConfig,
      privateKeyHex: walletContext.privateKeyHex,
    });
  }

  return params.onHosted(walletContext.walletConfig);
}
