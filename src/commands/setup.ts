import { DEFAULT_CHAT_API_URL, DEFAULT_INTERFACE_URL, readConfig } from "../config.js";
import { printJson } from "../output.js";
import { asRecord } from "../transport.js";
import type { CliDeps } from "../types.js";
import {
  countTokenSources,
  isLoopbackInterfaceHost,
  normalizeApiUrl,
  normalizeTokenInput,
  readTokenFromFile,
  readTokenFromStdin,
} from "./shared.js";
import { executeWalletPayerInitCommand } from "./wallet.js";
import {
  DEFAULT_DEV_CHAT_API_URL,
  DEFAULT_DEV_INTERFACE_URL,
  getNonEmptyEnvValue,
  getSetupWalletAddress,
  isInteractive,
  isJsonModeEnabled,
  normalizeSetupPayerMode,
  resolveStoredSetupToken,
  safeOrigin,
  type SetupValueSource,
} from "../setup/env.js";
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
  "Usage: cli setup [--url <interface-url>] [--chat-api-url <chat-api-url>] [--dev] [--token <refresh-token>|--token-file <path>|--token-stdin] [--agent <key>] [--network <network>] [--payer-mode hosted|local-generate|local-key|skip] [--payer-private-key-stdin|--payer-private-key-file <path>] [--json] [--link]";

export interface SetupCommandInput {
  url?: string;
  chatApiUrl?: string;
  dev?: boolean;
  token?: string;
  tokenFile?: string;
  tokenStdin?: boolean;
  agent?: string;
  network?: string;
  payerMode?: string;
  payerPrivateKeyStdin?: boolean;
  payerPrivateKeyFile?: string;
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
  payer?: {
    mode: "hosted" | "local";
    payerAddress: string | null;
    network: string;
    token: string;
    costPerPaidCallMicroUsdc: string;
  };
  next: string[];
}

type SetupOutputMode = "legacy" | "structured";

function parseSetupPayerResult(payload: unknown): SetupCommandOutput["payer"] {
  const root = asRecord(payload);
  const payer = asRecord(root.payer);
  if (!payer) {
    throw new Error("Payer setup did not return payer metadata.");
  }

  const mode = payer.mode;
  if (mode !== "hosted" && mode !== "local") {
    throw new Error("Payer setup returned an invalid mode.");
  }

  const payerAddress = typeof payer.payerAddress === "string" ? payer.payerAddress : null;
  const network = typeof payer.network === "string" ? payer.network : "base";
  const token = typeof payer.token === "string" ? payer.token : "usdc";
  const costPerPaidCallMicroUsdc =
    typeof payer.costPerPaidCallMicroUsdc === "string" ? payer.costPerPaidCallMicroUsdc : "1000";

  return {
    mode,
    payerAddress,
    network,
    token,
    costPerPaidCallMicroUsdc,
  };
}

function validateSetupPayerLocalKeyFileInput(filePath: string, deps: Pick<CliDeps, "fs">): void {
  let raw: string;
  try {
    raw = deps.fs.readFileSync(filePath, "utf8");
  } catch (error) {
    throw new Error(
      `Could not read payer private key file: ${filePath} (${error instanceof Error ? error.message : String(error)})`
    );
  }
  if (!raw.trim()) {
    throw new Error(`Payer private key file is empty: ${filePath}`);
  }
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
  if (input.payerPrivateKeyStdin && input.payerPrivateKeyFile) {
    throw new Error(`${SETUP_USAGE}\nProvide only one of --payer-private-key-stdin or --payer-private-key-file.`);
  }

  const requestedPayerMode = normalizeSetupPayerMode(input.payerMode);
  if (requestedPayerMode !== "local-key" && (input.payerPrivateKeyStdin || input.payerPrivateKeyFile)) {
    throw new Error(
      `${SETUP_USAGE}\n--payer-private-key-stdin/--payer-private-key-file require --payer-mode local-key.`
    );
  }
  if (input.tokenStdin && input.payerPrivateKeyStdin) {
    throw new Error(
      `${SETUP_USAGE}\nCannot combine --token-stdin with --payer-private-key-stdin in one setup run.`
    );
  }

  const current = readConfig(deps);
  const jsonMode = isJsonModeEnabled(input.json, deps);
  const interactive = isInteractive(deps) && !jsonMode;
  if (requestedPayerMode === "local-key") {
    if (!interactive && !input.payerPrivateKeyStdin && !input.payerPrivateKeyFile) {
      throw new Error(
        `${SETUP_USAGE}\n--payer-mode local-key requires --payer-private-key-stdin or --payer-private-key-file in non-interactive mode.`
      );
    }
    if (input.payerPrivateKeyFile) {
      validateSetupPayerLocalKeyFileInput(input.payerPrivateKeyFile, deps);
    }
  }
  const shouldConfigurePayer = requestedPayerMode !== undefined && requestedPayerMode !== "skip";
  const interactiveSetupStepCount = shouldConfigurePayer ? 4 : 3;

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
      if (!interactive) {
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
  if (interactive) {
    printSetupStep(deps, 2, interactiveSetupStepCount, "Browser authorization");
  }
  /* c8 ignore stop */

  /* c8 ignore start */
  if (interactive && networkSource === "env") {
    deps.stderr(`Using default network from COBUILD_CLI_NETWORK: ${defaultNetwork}`);
  }
  /* c8 ignore stop */

  if (!token) {
    if (!interactive) {
      throw new Error(`${SETUP_USAGE}\nMissing --token and no config found.`);
    }
    /* c8 ignore start */
    token = (await requestRefreshTokenViaBrowser({
      interfaceUrl: url,
      chatApiUrl,
      agent,
      payerMode: shouldConfigurePayer ? requestedPayerMode : undefined,
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

  /* c8 ignore start */
  if (interactive) {
    printSetupStep(deps, 3, interactiveSetupStepCount, "Save config + bootstrap wallet");
  }
  /* c8 ignore stop */

  const { path } = persistSetupConfig({
    deps,
    currentConfig: current,
    interfaceUrl: url,
    chatApiUrl,
    agent,
    refreshToken: token,
  });
  if (!jsonMode && outputMode === "legacy") {
    deps.stderr(`Saved config: ${path}`);
  }

  const walletResponse = await bootstrapWalletWithSetupErrorHandling({
    deps,
    agent,
    defaultNetwork,
  });

  let payer: SetupCommandOutput["payer"] | undefined;
  if (shouldConfigurePayer) {
    if (interactive) {
      /* c8 ignore start */
      printSetupStep(deps, 4, interactiveSetupStepCount, "Wallet payer");
      /* c8 ignore stop */
    }
    const payerResult = await executeWalletPayerInitCommand(
      {
        agent,
        mode: requestedPayerMode,
        privateKeyStdin: input.payerPrivateKeyStdin,
        privateKeyFile: input.payerPrivateKeyFile,
        noPrompt: !interactive,
      },
      deps
    );
    if (payerResult !== undefined) {
      payer = parseSetupPayerResult(payerResult);
    }
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
    ...(payer ? { payer } : {}),
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
      payer,
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
