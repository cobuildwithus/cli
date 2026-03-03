import { configPath, persistPatToken, readConfig, resolveMaskedToken, writeConfig } from "../config.js";
import type { CliDeps } from "../types.js";
import { countTokenSources, normalizeTokenInput, readTokenFromFile, readTokenFromStdin } from "./shared.js";
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
  interfaceUrl: string | null;
  chatApiUrl: string | null;
  token: string | null;
  tokenRef: unknown;
  agent: string | null;
  path: string;
}

function hasConfiguredInterfaceUrl(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
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
  if (typeof input.chatApiUrl === "string" && !hasConfiguredInterfaceUrl(input.url) && !hasConfiguredInterfaceUrl(current.url)) {
    throw new Error(
      `${CONFIG_SET_USAGE}\nSet --url before configuring --chat-api-url.`
    );
  }
  let next = { ...current };
  if (typeof input.url === "string") {
    next.url = input.url;
  }
  if (typeof input.chatApiUrl === "string") {
    next.chatApiUrl = input.chatApiUrl;
    next.chatApiUrlEnabled = true;
  }
  if (tokenFromOption !== undefined) {
    next = persistPatToken({
      deps,
      config: next,
      token: tokenFromOption,
      interfaceUrl: next.url,
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
  const chatApiUrl =
    current.chatApiUrlEnabled === true && typeof current.chatApiUrl === "string"
      ? current.chatApiUrl
      : null;
  return {
    interfaceUrl: current.url ?? null,
    chatApiUrl,
    token: resolveMaskedToken(deps, current),
    tokenRef: isSecretRef(current.auth?.tokenRef) ? current.auth.tokenRef : null,
    agent: current.agent ?? null,
    path: configPath(deps),
  };
}
