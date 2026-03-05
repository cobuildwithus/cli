import {
  clearPersistedRefreshToken,
  configPath,
  DEFAULT_CHAT_API_URL,
  DEFAULT_INTERFACE_URL,
  persistRefreshToken,
  readConfig,
  resolveMaskedToken,
  writeConfig,
} from "../config.js";
import type { CliConfig, CliDeps, SecretRef } from "../types.js";
import {
  countTokenSources,
  normalizeApiUrl,
  normalizeTokenInput,
  readTokenFromFile,
  readTokenFromStdin,
  validateAgentKey,
} from "./shared.js";
import { isSecretRef, resolveDefaultSecretProviderAlias } from "../secrets/ref-contract.js";
import { withDefaultSecretProviders } from "../secrets/runtime.js";

const CONFIG_SET_USAGE =
  "Usage: cli config set --url <interface-url> [--chat-api-url <chat-api-url>] [--token <refresh-token>|--token-file <path>|--token-stdin|--token-env <ENV_VAR>|--token-exec <provider:id>|--token-ref-json <json>] [--agent <key>]";
const ENV_VAR_NAME_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface ConfigSetCommandInput {
  url?: string;
  chatApiUrl?: string;
  token?: string;
  tokenFile?: string;
  tokenStdin?: boolean;
  tokenEnv?: string;
  tokenExec?: string;
  tokenRefJson?: string;
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

function parseTokenRefJson(raw: string): SecretRef {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `--token-ref-json must be valid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (!isSecretRef(parsed)) {
    throw new Error("--token-ref-json must decode to a valid SecretRef object.");
  }
  return parsed;
}

function resolveTokenExecProviderId(value: string, config: CliConfig): { provider: string; id: string } {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("--token-exec cannot be empty.");
  }

  const separator = trimmed.indexOf(":");
  if (separator > 0 && separator < trimmed.length - 1) {
    return {
      provider: trimmed.slice(0, separator).trim(),
      id: trimmed.slice(separator + 1).trim(),
    };
  }

  const provider = resolveDefaultSecretProviderAlias(config, "exec");
  return {
    provider,
    id: trimmed,
  };
}

function countTokenRefSources(
  input: Pick<ConfigSetCommandInput, "tokenEnv" | "tokenExec" | "tokenRefJson">
): number {
  return (
    (typeof input.tokenEnv === "string" ? 1 : 0) +
    (typeof input.tokenExec === "string" ? 1 : 0) +
    (typeof input.tokenRefJson === "string" ? 1 : 0)
  );
}

function resolveTokenRefFromOptions(
  input: ConfigSetCommandInput,
  current: CliConfig,
  deps: Pick<CliDeps, "homedir">
): SecretRef | undefined {
  const tokenRefOptionsCount = countTokenRefSources(input);
  if (tokenRefOptionsCount > 1) {
    throw new Error(
      `${CONFIG_SET_USAGE}\nProvide only one of --token-env, --token-exec, or --token-ref-json.`
    );
  }

  const configWithProviders = withDefaultSecretProviders(current, deps);

  if (typeof input.tokenEnv === "string") {
    const id = input.tokenEnv.trim();
    if (!id) {
      throw new Error("--token-env cannot be empty.");
    }
    if (!ENV_VAR_NAME_REGEX.test(id)) {
      throw new Error("--token-env must be a valid environment variable name.");
    }
    return {
      source: "env",
      provider: resolveDefaultSecretProviderAlias(configWithProviders, "env"),
      id,
    };
  }

  if (typeof input.tokenExec === "string") {
    const { provider, id } = resolveTokenExecProviderId(input.tokenExec, configWithProviders);
    if (!provider || !id) {
      throw new Error("--token-exec must be <provider:id> or <id>.");
    }

    const providerConfig = configWithProviders.secrets?.providers?.[provider];
    if (!providerConfig || providerConfig.source !== "exec") {
      throw new Error(
        `--token-exec provider "${provider}" is not configured as an exec secret provider.`
      );
    }

    return {
      source: "exec",
      provider,
      id,
    };
  }

  if (typeof input.tokenRefJson === "string") {
    const trimmed = input.tokenRefJson.trim();
    if (!trimmed) {
      throw new Error("--token-ref-json cannot be empty.");
    }
    return parseTokenRefJson(trimmed);
  }

  return undefined;
}

function safeOrigin(rawUrl: string): string | undefined {
  try {
    return new URL(rawUrl).origin;
  } catch {
    return undefined;
  }
}

function hasConfiguredUrl(url: string | undefined): boolean {
  return typeof url === "string" && url.trim().length > 0;
}

function resolveInterfaceUrl(url: string | undefined): string {
  if (hasConfiguredUrl(url)) {
    return url!.trim();
  }
  return DEFAULT_INTERFACE_URL;
}

function withDefaultUrls<T extends { url?: string; chatApiUrl?: string }>(
  config: T
): T & { url: string; chatApiUrl: string } {
  const configuredInterfaceUrl = typeof config.url === "string" ? config.url : undefined;
  const interfaceUrl = resolveInterfaceUrl(configuredInterfaceUrl);
  const configuredChatApiUrl = typeof config.chatApiUrl === "string" ? config.chatApiUrl.trim() : "";
  return {
    ...config,
    url: interfaceUrl,
    chatApiUrl:
      configuredChatApiUrl ||
      (hasConfiguredUrl(configuredInterfaceUrl) ? interfaceUrl : DEFAULT_CHAT_API_URL),
  };
}

export async function executeConfigSetCommand(
  input: ConfigSetCommandInput,
  deps: CliDeps
): Promise<ConfigSetCommandOutput> {
  const tokenStringSourceCount = countTokenSources({
    token: input.token,
    tokenFile: input.tokenFile,
    tokenStdin: input.tokenStdin,
  });
  const tokenRefSourceCount = countTokenRefSources(input);
  if (tokenStringSourceCount + tokenRefSourceCount > 1) {
    throw new Error(
      `${CONFIG_SET_USAGE}\nProvide only one token source: --token, --token-file, --token-stdin, --token-env, --token-exec, or --token-ref-json.`
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

  const current = readConfig(deps);
  const tokenRefFromOption = resolveTokenRefFromOptions(input, current, deps);

  const hasUpdate =
    typeof input.url === "string" ||
    typeof input.chatApiUrl === "string" ||
    tokenFromOption !== undefined ||
    tokenRefFromOption !== undefined ||
    typeof input.agent === "string";
  if (!hasUpdate) {
    throw new Error(CONFIG_SET_USAGE);
  }

  if (tokenFromOption !== undefined && !hasConfiguredUrl(current.url) && typeof input.url !== "string") {
    throw new Error(
      `${CONFIG_SET_USAGE}\nPass --url the first time you set a token so it can be bound to the correct interface origin.`
    );
  }

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
  if (normalizedInterfaceUrl !== undefined && typeof input.chatApiUrl !== "string") {
    const currentInterfaceUrl = resolveInterfaceUrl(current.url);
    const currentChatApiUrl =
      typeof current.chatApiUrl === "string" ? current.chatApiUrl.trim() : "";
    if (!currentChatApiUrl || currentChatApiUrl === currentInterfaceUrl) {
      next.chatApiUrl = normalizedInterfaceUrl;
    }
  }

  if (
    normalizedInterfaceUrl !== undefined &&
    tokenFromOption === undefined &&
    tokenRefFromOption === undefined
  ) {
    const currentUrl =
      hasConfiguredUrl(current.url) ? current.url!.trim() : DEFAULT_INTERFACE_URL;
    const nextOrigin = safeOrigin(normalizedInterfaceUrl);
    const currentOrigin = safeOrigin(currentUrl);
    if (nextOrigin !== undefined && nextOrigin !== currentOrigin) {
      const { token: _legacyToken, auth: _authConfig, ...withoutTokenAuth } = next;
      next = withoutTokenAuth;
      shouldClearPersistedAuth = true;
    }
  }

  if (shouldClearPersistedAuth) {
    clearPersistedRefreshToken(deps);
  }

  next = withDefaultUrls(next);

  if (tokenFromOption !== undefined) {
    const interfaceUrl = resolveInterfaceUrl(typeof next.url === "string" ? next.url : undefined);
    next = persistRefreshToken({
      deps,
      config: next,
      token: tokenFromOption,
      interfaceUrl,
    });
  }
  if (tokenRefFromOption !== undefined) {
    clearPersistedRefreshToken(deps);
    const configWithProviders = withDefaultSecretProviders(next, deps);
    const { token: _legacyToken, ...withoutLegacyToken } = configWithProviders;
    next = {
      ...withoutLegacyToken,
      auth: {
        ...(withoutLegacyToken.auth ?? {}),
        tokenRef: tokenRefFromOption,
      },
    };
  }
  if (typeof input.agent === "string") {
    next.agent = validateAgentKey(input.agent, "--agent");
  }

  writeConfig(deps, next);
  return {
    ok: true,
    path: configPath(deps),
  };
}

export function executeConfigShowCommand(deps: CliDeps): ConfigShowCommandOutput {
  const current = readConfig(deps);
  const normalized = withDefaultUrls(current);
  const interfaceUrl = String(normalized.url);
  const chatApiUrl = String(normalized.chatApiUrl);
  return {
    interfaceUrl,
    chatApiUrl,
    token: resolveMaskedToken(deps, current),
    tokenRef: isSecretRef(current.auth?.tokenRef) ? current.auth.tokenRef : null,
    agent: current.agent ?? null,
    path: configPath(deps),
  };
}
