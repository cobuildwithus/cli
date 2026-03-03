import {
  clearPersistedRefreshToken,
  configPath,
  persistRefreshToken,
  writeConfig,
} from "../config.js";
import { apiPost } from "../transport.js";
import type { CliConfig, CliDeps } from "../types.js";
import { isAuthFailure, isGenericInternalFailure } from "./oauth-flow.js";

const SETUP_AUTH_FAILURE_MESSAGE = [
  "OAuth authorization failed while bootstrapping wallet access.",
  "The saved token was cleared to avoid reusing it.",
  "Run setup again and approve a fresh browser authorization.",
].join(" ");
const SETUP_AUTH_FAILURE_CLEANUP_WARNING_MESSAGE = [
  "OAuth authorization failed while bootstrapping wallet access.",
  "Token cleanup may have failed; remove persisted credentials manually before retrying setup.",
].join(" ");
const SETUP_BACKEND_FAILURE_MESSAGE = [
  "Wallet bootstrap failed on the interface server.",
  "Check interface logs, run the CLI SQL migrations, and verify CDP env vars are set",
  "(CDP_API_KEY_ID, CDP_API_KEY_SECRET, CDP_WALLET_SECRET).",
].join(" ");

export function persistSetupConfig(params: {
  deps: CliDeps;
  currentConfig: CliConfig;
  interfaceUrl: string;
  chatApiUrl: string;
  agent: string;
  refreshToken: string;
}): { path: string } {
  const path = configPath(params.deps);
  const nextConfig = persistRefreshToken({
    deps: params.deps,
    config: {
      ...params.currentConfig,
      url: params.interfaceUrl,
      chatApiUrl: params.chatApiUrl,
      agent: params.agent,
    },
    token: params.refreshToken,
    interfaceUrl: params.interfaceUrl,
  });
  writeConfig(params.deps, nextConfig);
  return { path };
}

export async function bootstrapWalletWithSetupErrorHandling(params: {
  deps: CliDeps;
  agent: string;
  defaultNetwork: string;
}): Promise<unknown> {
  try {
    return await apiPost(params.deps, "/api/cli/wallet", {
      agentKey: params.agent,
      defaultNetwork: params.defaultNetwork,
    });
  } catch (error) {
    if (isAuthFailure(error)) {
      let cleanupSucceeded = true;
      try {
        clearPersistedRefreshToken(params.deps);
      } catch {
        cleanupSucceeded = false;
      }
      throw new Error(
        cleanupSucceeded ? SETUP_AUTH_FAILURE_MESSAGE : SETUP_AUTH_FAILURE_CLEANUP_WARNING_MESSAGE
      );
    }
    if (isGenericInternalFailure(error)) {
      throw new Error(SETUP_BACKEND_FAILURE_MESSAGE);
    }
    throw error;
  }
}
