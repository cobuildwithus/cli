import { DEFAULT_CHAT_API_URL, DEFAULT_INTERFACE_URL, configPath, readConfig, writeConfig } from "../config.js";
import { CLI_OAUTH_DEFAULT_SCOPE, CLI_OAUTH_WRITE_SCOPE } from "../oauth.js";
import { printJson } from "../output.js";
import { asRecord, isRecord } from "../transport.js";
import type { CliDeps } from "../types.js";
import {
  countTokenSources,
  isLoopbackInterfaceHost,
  normalizeApiUrl,
  normalizeTokenInput,
  readTokenFromFile,
  readTokenFromStdin,
} from "./shared.js";
import { executeWalletInitCommand } from "./wallet.js";
import {
  DEFAULT_DEV_CHAT_API_URL,
  DEFAULT_DEV_INTERFACE_URL,
  getNonEmptyEnvValue,
  getSetupWalletAddress,
  isInteractive,
  isJsonModeEnabled,
  normalizeSetupWalletMode,
  resolveStoredSetupToken,
  safeOrigin,
  type SetupValueSource,
} from "../setup/env.js";
import { normalizePrivateKeyHex, readTrimmedTextFromFile } from "../wallet/key-input.js";
import { parseWalletModePromptAnswer } from "../wallet/mode.js";
import {
  CLI_PRIMARY_COMMAND,
  printSetupStep,
  printSetupSuccessSummary,
  printSetupWizardIntro,
  promptLine,
  promptSecret,
} from "../setup/interactive.js";
import { maybeLinkCliGlobalCommand } from "../setup/link.js";
import { requestRefreshTokenViaBrowser } from "../setup/oauth-flow.js";
import { bootstrapWalletWithSetupErrorHandling, persistSetupConfig } from "../setup/config-write.js";

const SETUP_USAGE =
  "Usage: cli setup [--url <interface-url>] [--chat-api-url <chat-api-url>] [--dev] [--token <refresh-token>|--token-file <path>|--token-stdin] [--agent <key>] [--network <network>] [--write] [--show-approval-url] --wallet-mode hosted|local-generate|local-key [--wallet-private-key-stdin|--wallet-private-key-file <path>] [--json] [--link]";

export interface SetupCommandInput {
  url?: string;
  chatApiUrl?: string;
  dev?: boolean;
  token?: string;
  tokenFile?: string;
  tokenStdin?: boolean;
  agent?: string;
  network?: string;
  write?: boolean;
  showApprovalUrl?: boolean;
  walletMode?: string;
  walletPrivateKeyStdin?: boolean;
  walletPrivateKeyFile?: string;
  json?: boolean;
  link?: boolean;
}

export interface SetupCommandOutput {
  ok: true;
  config: {
    interfaceUrl: string;
    chatApiUrl: string;
    agent: string;
    path: string;
  };
  defaultNetwork: string;
  wallet: unknown;
  walletConfig: {
    mode: "hosted" | "local";
    walletAddress: string | null;
    network: string;
    token: string;
    costPerPaidCallMicroUsdc: string;
  };
  next: string[];
}

type SetupOutputMode = "legacy" | "structured";

function parseSetupWalletConfigResult(payload: unknown): SetupCommandOutput["walletConfig"] {
  const root = asRecord(payload);
  if (!isRecord(root.walletConfig)) {
    throw new Error("Wallet setup did not return wallet metadata.");
  }
  const walletConfig = asRecord(root.walletConfig);

  const mode = walletConfig.mode;
  if (mode !== "hosted" && mode !== "local") {
    throw new Error("Wallet setup returned an invalid mode.");
  }

  const walletAddress = typeof walletConfig.walletAddress === "string" ? walletConfig.walletAddress : null;
  const network = typeof walletConfig.network === "string" ? walletConfig.network : "base";
  const token = typeof walletConfig.token === "string" ? walletConfig.token : "usdc";
  const costPerPaidCallMicroUsdc =
    typeof walletConfig.costPerPaidCallMicroUsdc === "string"
      ? walletConfig.costPerPaidCallMicroUsdc
      : "1000";

  return {
    mode,
    walletAddress,
    network,
    token,
    costPerPaidCallMicroUsdc,
  };
}

function validateSetupWalletLocalKeyFileInput(filePath: string, deps: Pick<CliDeps, "fs">): void {
  const privateKey = readTrimmedTextFromFile(deps, filePath, "wallet private key");
  normalizePrivateKeyHex(privateKey);
}

async function resolveSetupWalletMode(params: {
  requestedWalletMode: ReturnType<typeof normalizeSetupWalletMode>;
  interactive: boolean;
}): Promise<"hosted" | "local-generate" | "local-key"> {
  if (params.requestedWalletMode) {
    return params.requestedWalletMode;
  }
  if (!params.interactive) {
    throw new Error(`${SETUP_USAGE}\nMissing --wallet-mode in non-interactive mode.`);
  }

  /* c8 ignore start */
  const answer = await promptLine(
    "Wallet type [hosted|local-generate|local-key or 1|2|3]",
    "hosted"
  );
  const selected = parseWalletModePromptAnswer(answer);
  if (selected) return selected;
  throw new Error(`${SETUP_USAGE}\n--wallet-mode must be one of: hosted, local-generate, local-key`);
  /* c8 ignore stop */
}

async function runSetupCommand(
  input: SetupCommandInput,
  deps: CliDeps,
  outputMode: SetupOutputMode
): Promise<SetupCommandOutput> {
  const tokenSourceCount = countTokenSources({
    token: input.token,
    tokenFile: input.tokenFile,
    tokenStdin: input.tokenStdin,
  });
  if (tokenSourceCount > 1) {
    throw new Error(`${SETUP_USAGE}\nProvide only one of --token, --token-file, or --token-stdin.`);
  }
  if (input.walletPrivateKeyStdin && input.walletPrivateKeyFile) {
    throw new Error(`${SETUP_USAGE}\nProvide only one of --wallet-private-key-stdin or --wallet-private-key-file.`);
  }
  if (input.tokenStdin && input.walletPrivateKeyStdin) {
    throw new Error(
      `${SETUP_USAGE}\nCannot combine --token-stdin with --wallet-private-key-stdin in one setup run.`
    );
  }

  const current = readConfig(deps);
  const jsonMode = isJsonModeEnabled(input.json, deps);
  const interactive = isInteractive(deps) && !jsonMode;
  const requestedWalletMode = normalizeSetupWalletMode(input.walletMode);
  const walletMode = await resolveSetupWalletMode({
    requestedWalletMode,
    interactive,
  });
  if (walletMode !== "local-key" && (input.walletPrivateKeyStdin || input.walletPrivateKeyFile)) {
    throw new Error(
      `${SETUP_USAGE}\n--wallet-private-key-stdin/--wallet-private-key-file require --wallet-mode local-key.`
    );
  }
  if (walletMode === "local-key") {
    if (!interactive && !input.walletPrivateKeyStdin && !input.walletPrivateKeyFile) {
      throw new Error(
        `${SETUP_USAGE}\n--wallet-mode local-key requires --wallet-private-key-stdin or --wallet-private-key-file in non-interactive mode.`
      );
    }
    if (input.walletPrivateKeyFile) {
      validateSetupWalletLocalKeyFileInput(input.walletPrivateKeyFile, deps);
    }
  }
  const hostedMode = walletMode === "hosted";
  const interactiveSetupStepCount = hostedMode ? 4 : 3;

  const storedUrl = typeof current.url === "string" ? current.url.trim() : "";
  const storedChatApiUrl = typeof current.chatApiUrl === "string" ? current.chatApiUrl.trim() : "";
  const envUrl = getNonEmptyEnvValue(deps, "COBUILD_CLI_URL");
  const envNetwork = getNonEmptyEnvValue(deps, "COBUILD_CLI_NETWORK");
  const defaultInterfaceUrl =
    input.dev === true ? DEFAULT_DEV_INTERFACE_URL : DEFAULT_INTERFACE_URL;

  let urlSource: SetupValueSource = "default";
  let url: string | undefined;
  if (typeof input.url === "string") {
    url = input.url;
    urlSource = "flag";
  } else if (storedUrl) {
    url = storedUrl;
    urlSource = "config";
  } else if (envUrl) {
    url = envUrl;
    urlSource = "env";
  }
  const explicitChatApiUrl = typeof input.chatApiUrl === "string" ? input.chatApiUrl : undefined;

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
  let storedToken = "";
  if (tokenFromOption === undefined) {
    try {
      storedToken = resolveStoredSetupToken(current, deps);
    } catch (error) {
      if (!interactive && walletMode === "hosted") {
        throw error;
      }
    }
  }

  const defaultAgent = current.agent || "default";
  let networkSource: SetupValueSource = "default";
  let defaultNetwork = "base";
  if (typeof input.network === "string") {
    defaultNetwork = input.network;
    networkSource = "flag";
  } else if (envNetwork) {
    defaultNetwork = envNetwork;
    networkSource = "env";
  }

  let token = tokenFromOption ?? (storedToken || undefined);
  const agent = input.agent || defaultAgent;
  const oauthNeedsWriteScope = input.write === true || hostedMode;
  const oauthScope = oauthNeedsWriteScope ? CLI_OAUTH_WRITE_SCOPE : CLI_OAUTH_DEFAULT_SCOPE;

  /* c8 ignore start */
  if (interactive) {
    printSetupWizardIntro(deps);
  }
  /* c8 ignore stop */

  /* c8 ignore start */
  if (interactive) {
    printSetupStep(deps, 1, interactiveSetupStepCount, "Interface URL");
  }
  /* c8 ignore stop */

  if (!url) {
    if (!interactive) {
      url = defaultInterfaceUrl;
      urlSource = "default";
    } else {
      /* c8 ignore start */
      url = await promptLine("Interface URL", defaultInterfaceUrl);
      urlSource = "interactive";
      /* c8 ignore stop */
    }
  } else {
    /* c8 ignore start */
    if (interactive) {
      if (urlSource === "env") {
        deps.stderr(`Using interface URL from COBUILD_CLI_URL: ${url}`);
      } else {
        deps.stderr(`Using: ${url}`);
      }
    }
    /* c8 ignore stop */
  }

  if (!interactive && urlSource === "env") {
    throw new Error(
      `${SETUP_USAGE}\nCOBUILD_CLI_URL came from environment for first-time setup. Pass --url explicitly to trust it.`
    );
  }

  url = normalizeApiUrl(url, "Interface URL");
  const previousInterfaceOrigin = safeOrigin(storedUrl);
  const currentInterfaceOrigin = safeOrigin(url);
  const interfaceOriginChanged =
    previousInterfaceOrigin !== undefined &&
    currentInterfaceOrigin !== undefined &&
    previousInterfaceOrigin !== currentInterfaceOrigin;

  let chatApiUrl = explicitChatApiUrl;
  if (!chatApiUrl && storedChatApiUrl && !interfaceOriginChanged) {
    chatApiUrl = storedChatApiUrl;
  }
  if (!chatApiUrl) {
    const hostname = new URL(url).hostname;
    chatApiUrl = isLoopbackInterfaceHost(hostname) ? DEFAULT_DEV_CHAT_API_URL : DEFAULT_CHAT_API_URL;
  }
  chatApiUrl = normalizeApiUrl(chatApiUrl, "Chat API URL");

  /* c8 ignore start */
  if (interactive && networkSource === "env") {
    deps.stderr(`Using default network from COBUILD_CLI_NETWORK: ${defaultNetwork}`);
  }
  /* c8 ignore stop */

  if (hostedMode) {
    /* c8 ignore start */
    if (interactive) {
      printSetupStep(deps, 2, interactiveSetupStepCount, "Browser authorization");
    }
    /* c8 ignore stop */

    if (!token) {
      if (!interactive) {
        throw new Error(`${SETUP_USAGE}\nMissing --token and no config found.`);
      }
      /* c8 ignore start */
      if (input.write !== true) {
        deps.stderr(
          "Hosted wallet setup needs write authorization; requesting write scope for browser approval."
        );
      }
      token = (await requestRefreshTokenViaBrowser({
        interfaceUrl: url,
        chatApiUrl,
        agent,
        scope: oauthScope,
        showApprovalUrl: input.showApprovalUrl,
        walletMode,
        deps,
      })) ?? undefined;
      if (!token) {
        deps.stderr("Falling back to manual token entry.");
        deps.stderr("Tip: paste from clipboard instead of using --token in shell history.");
        token = await promptSecret("CLI refresh token (input hidden)");
      }
      /* c8 ignore stop */
    } else {
      /* c8 ignore start */
      if (interactive) {
        if (tokenFromOption !== undefined) {
          deps.stderr("Using a refresh token provided on this command.");
        } else {
          deps.stderr("Using an existing refresh token from your config.");
        }
      }
      /* c8 ignore stop */
    }

    if (!token) {
      /* c8 ignore next */
      throw new Error("Token cannot be empty");
    }
  } else {
    /* c8 ignore start */
    if (interactive && !token) {
      deps.stderr("Local wallet mode selected. Skipping browser authorization.");
    }
    /* c8 ignore stop */
  }

  /* c8 ignore start */
  if (interactive) {
    printSetupStep(
      deps,
      hostedMode ? 3 : 2,
      interactiveSetupStepCount,
      hostedMode ? "Save config + bootstrap wallet" : "Save config"
    );
  }
  /* c8 ignore stop */

  let path: string;
  if (token) {
    path = persistSetupConfig({
      deps,
      currentConfig: current,
      interfaceUrl: url,
      chatApiUrl,
      agent,
      refreshToken: token,
    }).path;
  } else {
    path = configPath(deps);
    writeConfig(deps, {
      ...current,
      url,
      chatApiUrl,
      agent,
    });
  }
  if (!jsonMode && outputMode === "legacy") {
    deps.stderr(`Saved config: ${path}`);
  }

  let walletResponse: unknown;
  if (hostedMode) {
    walletResponse = await bootstrapWalletWithSetupErrorHandling({
      deps,
      agent,
      defaultNetwork,
    });
  }

  if (interactive) {
    /* c8 ignore start */
    printSetupStep(deps, interactiveSetupStepCount, interactiveSetupStepCount, "Wallet mode");
    /* c8 ignore stop */
  }
  const walletInitResult = await executeWalletInitCommand(
    {
      agent,
      mode: walletMode,
      privateKeyStdin: input.walletPrivateKeyStdin,
      privateKeyFile: input.walletPrivateKeyFile,
      noPrompt: !interactive,
    },
    deps
  );
  const walletConfig = parseSetupWalletConfigResult(walletInitResult);

  if (!walletResponse) {
    walletResponse = {
      ok: true,
      wallet: {
        ownerAddress: walletConfig.walletAddress,
        address: walletConfig.walletAddress,
        agentKey: agent,
        defaultNetwork,
      },
    };
  }

  const successPayload: SetupCommandOutput = {
    ok: true,
    config: {
      interfaceUrl: url,
      chatApiUrl,
      agent,
      path,
    },
    defaultNetwork,
    wallet: walletResponse,
    walletConfig,
    next: [
      `Run: ${CLI_PRIMARY_COMMAND} wallet`,
      `Run: ${CLI_PRIMARY_COMMAND} send usdc 0.10 <to> (or ${CLI_PRIMARY_COMMAND} send eth 0.00001 <to>)`,
    ],
  };

  const linkStatus = jsonMode
    ? "not-requested"
    : await maybeLinkCliGlobalCommand(deps, input.link === true);

  if (outputMode === "legacy" && (jsonMode || !interactive)) {
    printJson(deps, successPayload);
    return successPayload;
  }

  if (outputMode === "legacy") {
    printSetupSuccessSummary({
      deps,
      configPath: path,
      defaultNetwork,
      walletAddress: getSetupWalletAddress(walletResponse),
      walletConfig,
      linkStatus,
    });
  }

  return successPayload;
}

export async function executeSetupCommand(
  input: SetupCommandInput,
  deps: CliDeps
): Promise<SetupCommandOutput> {
  return await runSetupCommand(input, deps, "structured");
}
