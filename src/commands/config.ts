import {
  clearPersistedPatToken,
  configPath,
  DEFAULT_CHAT_API_URL,
  DEFAULT_INTERFACE_URL,
  persistPatToken,
  readConfig,
  resolveMaskedToken,
  writeConfig,
} from "../config.js";
import type { CliDeps } from "../types.js";
import {
  countTokenSources,
  normalizeApiUrl,
  normalizeTokenInput,
  readTokenFromFile,
  readTokenFromStdin,
} from "./shared.js";
import { isSecretRef } from "../secrets/ref-contract.js";

const CONFIG_SET_USAGE =
  "Usage: cli config set --url <interface-url> [--chat-api-url <chat-api-url>] --token <pat>|--token-file <path>|--token-stdin [--agent <key>]";

export interface ConfigSetCommandInput {
  url?: string;
  chatApiUrl?: string;
  token?: string;
  tokenFile?: string;
  tokenStdin?: boolean;
  agent?: string;
}

export interface ConfigSetCommandOutput {
  ok: true;
  path: string;
}

export interface ConfigShowCommandOutput {
  interfaceUrl: string;
  chatApiUrl: string;
  token: string | null;
  tokenRef: unknown;
  agent: string | null;
  path: string;
}

function safeOrigin(rawUrl: string): string | undefined {
  try {
    return new URL(rawUrl).origin;
  } catch {
    return undefined;
  }
}

export async function executeConfigSetCommand(
  input: ConfigSetCommandInput,
  deps: CliDeps
): Promise<ConfigSetCommandOutput> {
  const tokenSourceCount = countTokenSources({
    token: input.token,
    tokenFile: input.tokenFile,
    tokenStdin: input.tokenStdin,
  });
  if (tokenSourceCount > 1) {
    throw new Error(
      `${CONFIG_SET_USAGE}\nProvide only one of --token, --token-file, or --token-stdin.`
    );
  }

  let tokenFromOption: string | undefined;
  if (typeof input.token === "string") {
    tokenFromOption = normalizeTokenInput(input.token);
  } else if (typeof input.tokenFile === "string") {
    tokenFromOption = readTokenFromFile(input.tokenFile, deps);
  } else if (input.tokenStdin === true) {
    tokenFromOption = await readTokenFromStdin(deps);
  }
  if (tokenFromOption !== undefined && tokenFromOption.length === 0) {
    throw new Error("Token cannot be empty");
  }

  const hasUpdate =
    typeof input.url === "string" ||
    typeof input.chatApiUrl === "string" ||
    tokenFromOption !== undefined ||
    typeof input.agent === "string";
  if (!hasUpdate) {
    throw new Error(CONFIG_SET_USAGE);
  }

  const current = readConfig(deps);
  let next = { ...current };
  let shouldClearPersistedAuth = false;
  let normalizedInterfaceUrl: string | undefined;
  if (typeof input.url === "string") {
    normalizedInterfaceUrl = normalizeApiUrl(input.url, "Interface URL");
    next.url = normalizedInterfaceUrl;
  }
  if (typeof input.chatApiUrl === "string") {
    next.chatApiUrl = normalizeApiUrl(input.chatApiUrl, "Chat API URL");
  }

  if (normalizedInterfaceUrl !== undefined && tokenFromOption === undefined) {
    const currentUrl =
      typeof current.url === "string" && current.url.trim().length > 0 ? current.url : DEFAULT_INTERFACE_URL;
    const nextOrigin = safeOrigin(normalizedInterfaceUrl);
    const currentOrigin = safeOrigin(currentUrl);
    if (nextOrigin !== undefined && nextOrigin !== currentOrigin) {
      const { token: _legacyToken, auth: _authConfig, ...withoutTokenAuth } = next;
      next = withoutTokenAuth;
      shouldClearPersistedAuth = true;
    }
  }

  if (shouldClearPersistedAuth) {
    clearPersistedPatToken(deps);
  }

  if (tokenFromOption !== undefined) {
    const interfaceUrl =
      typeof next.url === "string" && next.url.trim().length > 0 ? next.url : DEFAULT_INTERFACE_URL;
    next = persistPatToken({
      deps,
      config: next,
      token: tokenFromOption,
      interfaceUrl,
    });
  }
  if (typeof input.agent === "string") {
    next.agent = input.agent;
  }

  writeConfig(deps, next);
  return {
    ok: true,
    path: configPath(deps),
  };
}

export function executeConfigShowCommand(deps: CliDeps): ConfigShowCommandOutput {
  const current = readConfig(deps);
  const interfaceUrl =
    typeof current.url === "string" && current.url.trim().length > 0 ? current.url : DEFAULT_INTERFACE_URL;
  const chatApiUrl =
    typeof current.chatApiUrl === "string" && current.chatApiUrl.trim().length > 0
      ? current.chatApiUrl
      : typeof current.url === "string" && current.url.trim().length > 0
        ? interfaceUrl
        : DEFAULT_CHAT_API_URL;
  return {
    interfaceUrl,
    chatApiUrl,
    token: resolveMaskedToken(deps, current),
    tokenRef: isSecretRef(current.auth?.tokenRef) ? current.auth.tokenRef : null,
    agent: current.agent ?? null,
    path: configPath(deps),
  };
}
