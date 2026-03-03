/* v8 ignore file */
import { parseCliWalletAddressForSetupSummary } from "../api-response-schemas.js";
import { isSecretRef } from "../secrets/ref-contract.js";
import { resolveSecretRefString } from "../secrets/runtime.js";
import type { CliConfig, CliDeps } from "../types.js";
import {
  normalizeOptionalWalletInitMode,
  type WalletInitMode,
} from "../wallet/mode.js";

export const DEFAULT_DEV_INTERFACE_URL = "http://localhost:3000";
export const DEFAULT_DEV_CHAT_API_URL = "http://localhost:4000";

export type SetupWalletMode = WalletInitMode;

export type SetupValueSource = "flag" | "config" | "env" | "default" | "interactive";

export function normalizeSetupWalletMode(value: string | undefined): SetupWalletMode | undefined {
  return normalizeOptionalWalletInitMode(value, "--wallet-mode");
}

export function isInteractive(deps: Pick<CliDeps, "isInteractive">): boolean {
  if (deps.isInteractive) return deps.isInteractive();
  return Boolean(process.stdin.isTTY && process.stderr.isTTY);
}

function getEnv(deps: Pick<CliDeps, "env">): NodeJS.ProcessEnv {
  return deps.env ?? process.env;
}

export function getNonEmptyEnvValue(
  deps: Pick<CliDeps, "env">,
  key: "COBUILD_CLI_OUTPUT" | "COBUILD_CLI_URL" | "COBUILD_CLI_NETWORK"
): string | undefined {
  const value = getEnv(deps)[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function isJsonModeEnabled(value: unknown, deps: Pick<CliDeps, "env">): boolean {
  if (value === true) return true;
  return getNonEmptyEnvValue(deps, "COBUILD_CLI_OUTPUT")?.toLowerCase() === "json";
}

export function safeOrigin(rawUrl: string): string | undefined {
  try {
    return new URL(rawUrl).origin;
  } catch {
    return undefined;
  }
}

export function resolveStoredSetupToken(
  current: CliConfig,
  deps: Pick<CliDeps, "fs" | "homedir" | "env">
): string {
  if (isSecretRef(current.auth?.tokenRef)) {
    return resolveSecretRefString({
      deps,
      config: current,
      ref: current.auth.tokenRef,
    });
  }
  return typeof current.token === "string" ? current.token.trim() : "";
}

export function getSetupWalletAddress(walletResponse: unknown): string | null {
  return parseCliWalletAddressForSetupSummary(walletResponse);
}

export function resolveInterfaceSetupCompleteUrl(params: {
  interfaceUrl: string;
  agent: string;
  walletMode?: SetupWalletMode;
}): string {
  const { interfaceUrl, agent, walletMode } = params;
  const normalizedBase = interfaceUrl.endsWith("/") ? interfaceUrl : `${interfaceUrl}/`;
  const url = new URL("home", normalizedBase);
  url.searchParams.set("cli_setup_complete", "1");
  url.searchParams.set("agent_key", agent);
  if (walletMode) {
    url.searchParams.set("wallet_mode", walletMode);
    // Keep old query key for in-flight interface deployments.
    url.searchParams.set("payer_mode", walletMode);
  }
  return url.toString();
}
