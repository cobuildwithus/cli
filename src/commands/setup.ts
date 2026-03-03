import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  clearPersistedPatToken,
  configPath,
  DEFAULT_CHAT_API_URL,
  DEFAULT_INTERFACE_URL,
  persistPatToken,
  readConfig,
  writeConfig,
} from "../config.js";
import { printJson } from "../output.js";
import { isSecretRef } from "../secrets/ref-contract.js";
import { resolveSecretRefString } from "../secrets/runtime.js";
import { buildSetupApprovalUrl, createSetupApprovalSession } from "../setup-approval.js";
import { apiPost, asRecord } from "../transport.js";
import type { CliDeps } from "../types.js";
import {
  countTokenSources,
  isLoopbackInterfaceHost,
  normalizeApiUrl,
  normalizeTokenInput,
  readTokenFromFile,
  readTokenFromStdin,
} from "./shared.js";
import { executeFarcasterX402InitCommand } from "./farcaster.js";

const SETUP_USAGE =
  "Usage: cli setup [--url <interface-url>] [--chat-api-url <chat-api-url>] [--dev] [--token <pat>|--token-file <path>|--token-stdin] [--agent <key>] [--network <network>] [--x402-mode hosted|local-generate|local-key|skip] [--x402-private-key-stdin|--x402-private-key-file <path>] [--json] [--link]";
const SETUP_AUTH_FAILURE_MESSAGE = [
  "PAT authorization failed while bootstrapping wallet access.",
  "The saved token was cleared to avoid reusing it.",
  "Run setup again and approve a fresh token in the browser.",
].join(" ");
const SETUP_AUTH_FAILURE_CLEANUP_WARNING_MESSAGE = [
  "PAT authorization failed while bootstrapping wallet access.",
  "Token cleanup may have failed; remove persisted credentials manually before retrying setup.",
].join(" ");
const SETUP_BACKEND_FAILURE_MESSAGE = [
  "Wallet bootstrap failed on the interface server.",
  "Check interface logs, run the CLI SQL migrations, and verify CDP env vars are set",
  "(CDP_API_KEY_ID, CDP_API_KEY_SECRET, CDP_WALLET_SECRET).",
].join(" ");
const CLI_PACKAGE_NAME = "@cobuild/cli";
const SETUP_PNPM_PATH_HINT =
  "Auto-link skipped: unable to locate a trusted pnpm entrypoint for this shell session. Run manually: pnpm link --global";
const DEFAULT_DEV_INTERFACE_URL = "http://localhost:3000";
const DEFAULT_DEV_CHAT_API_URL = "http://localhost:4000";
type SetupX402Mode = "hosted" | "local-generate" | "local-key" | "skip";

function isSetupX402Mode(value: string): value is SetupX402Mode {
  return value === "hosted" || value === "local-generate" || value === "local-key" || value === "skip";
}

export interface SetupCommandInput {
  url?: string;
  chatApiUrl?: string;
  dev?: boolean;
  token?: string;
  tokenFile?: string;
  tokenStdin?: boolean;
  agent?: string;
  network?: string;
  x402Mode?: string;
  x402PrivateKeyStdin?: boolean;
  x402PrivateKeyFile?: string;
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
  x402?: {
    mode: "hosted" | "local";
    payerAddress: string | null;
    network: string;
    token: string;
    costPerPaidCallMicroUsdc: string;
  };
  next: string[];
}

/* c8 ignore start */
function isInteractive(deps: Pick<CliDeps, "isInteractive">): boolean {
  if (deps.isInteractive) return deps.isInteractive();
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function getEnv(deps: Pick<CliDeps, "env">): NodeJS.ProcessEnv {
  return deps.env ?? process.env;
}

function getNonEmptyEnvValue(
  deps: Pick<CliDeps, "env">,
  key: "COBUILD_CLI_OUTPUT" | "COBUILD_CLI_URL" | "COBUILD_CLI_NETWORK"
): string | undefined {
  const value = getEnv(deps)[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isAuthFailure(error: unknown): boolean {
  return error instanceof Error && /unauthorized|forbidden/i.test(error.message);
}

function isGenericInternalFailure(error: unknown): boolean {
  return error instanceof Error && /\binternal error\b/i.test(error.message);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

function safeOrigin(rawUrl: string): string | undefined {
  try {
    return new URL(rawUrl).origin;
  } catch {
    return undefined;
  }
}

function resolveStoredSetupToken(
  current: ReturnType<typeof readConfig>,
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

function isJsonModeEnabled(value: unknown, deps: Pick<CliDeps, "env">): boolean {
  if (value === true) return true;
  return getNonEmptyEnvValue(deps, "COBUILD_CLI_OUTPUT")?.toLowerCase() === "json";
}

function getSetupWalletAddress(walletResponse: unknown): string | null {
  const responseRecord = asRecord(walletResponse);
  const walletRecord = asRecord(responseRecord.wallet);
  return walletRecord && typeof walletRecord.address === "string" ? walletRecord.address : null;
}

function normalizeSetupX402Mode(value: string | undefined): SetupX402Mode | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (isSetupX402Mode(normalized)) {
    return normalized;
  }
  throw new Error("--x402-mode must be one of: hosted, local-generate, local-key, skip");
}

async function promptSetupX402Mode(deps: Pick<CliDeps, "stderr">): Promise<SetupX402Mode> {
  while (true) {
    const input = (await promptLine(
      "Farcaster x402 mode (hosted/local-generate/local-key/skip)",
      "skip"
    ))
      .trim()
      .toLowerCase();
    if (isSetupX402Mode(input)) {
      return input;
    }
    deps.stderr("Invalid x402 mode. Choose: hosted, local-generate, local-key, or skip.");
  }
}

function parseSetupX402Result(payload: unknown): SetupCommandOutput["x402"] {
  const root = asRecord(payload);
  const x402 = asRecord(root.x402);
  if (!x402) {
    throw new Error("x402 setup did not return x402 metadata.");
  }

  const mode = x402.mode;
  if (mode !== "hosted" && mode !== "local") {
    throw new Error("x402 setup returned an invalid mode.");
  }

  const payerAddress = typeof x402.payerAddress === "string" ? x402.payerAddress : null;
  const network = typeof x402.network === "string" ? x402.network : "base";
  const token = typeof x402.token === "string" ? x402.token : "usdc";
  const costPerPaidCallMicroUsdc =
    typeof x402.costPerPaidCallMicroUsdc === "string" ? x402.costPerPaidCallMicroUsdc : "1000";

  return {
    mode,
    payerAddress,
    network,
    token,
    costPerPaidCallMicroUsdc,
  };
}

type GlobalLinkStatus = "not-requested" | "linked" | "failed" | "skipped";

function firstNonEmptyLine(input: string): string | null {
  for (const line of input.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return null;
}

function resolveSetupPackageRoot(): string | null {
  let current = path.dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 8; depth += 1) {
    const packageJsonPath = path.join(current, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      try {
        const rawPackage = fs.readFileSync(packageJsonPath, "utf8");
        const parsedPackage = JSON.parse(rawPackage) as { name?: unknown };
        if (parsedPackage.name === CLI_PACKAGE_NAME) {
          return current;
        }
      } catch {
        return null;
      }
    }

    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

function resolveTrustedPnpmExecPath(deps: Pick<CliDeps, "env">): string | null {
  const npmExecPath = getEnv(deps).npm_execpath?.trim();
  if (!npmExecPath || !path.isAbsolute(npmExecPath)) return null;
  if (!fs.existsSync(npmExecPath)) return null;

  const basename = path.basename(npmExecPath).toLowerCase();
  if (!basename.includes("pnpm")) return null;
  return npmExecPath;
}

function buildTrustedPnpmInvocation(pnpmExecPath: string): { command: string; args: string[] } {
  const normalized = pnpmExecPath.toLowerCase();
  if (normalized.endsWith(".js") || normalized.endsWith(".cjs") || normalized.endsWith(".mjs")) {
    return {
      command: process.execPath,
      args: [pnpmExecPath, "link", "--global"],
    };
  }

  return {
    command: pnpmExecPath,
    args: ["link", "--global"],
  };
}

async function runPnpmLinkGlobal(params: {
  deps: Pick<CliDeps, "runSetupLinkGlobal">;
  cwd: string;
  pnpmExecPath: string;
}): Promise<{ ok: boolean; output: string }> {
  if (params.deps.runSetupLinkGlobal) {
    const invocation = buildTrustedPnpmInvocation(params.pnpmExecPath);
    return await params.deps.runSetupLinkGlobal({
      cwd: params.cwd,
      command: invocation.command,
      args: invocation.args,
    });
  }

  try {
    const { spawn } = await import("node:child_process");
    const invocation = buildTrustedPnpmInvocation(params.pnpmExecPath);
    return await new Promise((resolve) => {
      const output: string[] = [];
      const child = spawn(invocation.command, invocation.args, {
        cwd: params.cwd,
        stdio: ["ignore", "pipe", "pipe"],
      });

      child.stdout?.on("data", (chunk) => {
        output.push(chunk.toString("utf8"));
      });
      child.stderr?.on("data", (chunk) => {
        output.push(chunk.toString("utf8"));
      });

      child.once("error", (error) => {
        resolve({
          ok: false,
          output: error instanceof Error ? error.message : String(error),
        });
      });
      child.once("exit", (code) => {
        resolve({
          ok: code === 0,
          output: output.join("").trim(),
        });
      });
    });
  } catch (error) {
    return {
      ok: false,
      output: error instanceof Error ? error.message : String(error),
    };
  }
}

async function maybeLinkCliGlobalCommand(
  deps: Pick<CliDeps, "env" | "runSetupLinkGlobal" | "stderr">,
  shouldLink: boolean
): Promise<GlobalLinkStatus> {
  if (!shouldLink) return "not-requested";

  const setupPackageRoot = resolveSetupPackageRoot();
  if (!setupPackageRoot) {
    deps.stderr("Auto-link skipped: could not determine the cli package root.");
    deps.stderr("Run manually: pnpm link --global");
    return "skipped";
  }

  const pnpmExecPath = resolveTrustedPnpmExecPath(deps);
  if (!pnpmExecPath) {
    deps.stderr(SETUP_PNPM_PATH_HINT);
    return "skipped";
  }

  deps.stderr("Installing global `cli` command via pnpm link...");
  const linkResult = await runPnpmLinkGlobal({
    deps,
    cwd: setupPackageRoot,
    pnpmExecPath,
  });
  if (linkResult.ok) {
    deps.stderr("Global command installed. You can now run `cli ...` directly.");
    return "linked";
  }

  const normalizedOutput = linkResult.output.toLowerCase();
  if (
    normalizedOutput.includes("err_pnpm_no_global_bin_dir") ||
    normalizedOutput.includes("unable to find the global bin directory")
  ) {
    deps.stderr("Auto-link failed: pnpm global bin directory is not configured.");
    deps.stderr("Run once: pnpm setup");
    deps.stderr("Then restart your shell and run: pnpm link --global");
    deps.stderr("Until then, run commands via: pnpm start -- <command>");
    return "failed";
  }

  const firstLine = firstNonEmptyLine(linkResult.output);
  if (firstLine) deps.stderr(`Auto-link failed: ${firstLine}`);
  deps.stderr("Auto-link failed. Run manually: pnpm link --global");
  return "failed";
}

async function activateTerminalApp(appName: string): Promise<boolean> {
  try {
    const { spawn } = await import("node:child_process");

    return await new Promise((resolve) => {
      const child = spawn("osascript", ["-e", `tell application "${appName}" to activate`], {
        stdio: "ignore",
      });
      child.once("error", () => resolve(false));
      child.once("exit", (code) => resolve(code === 0));
    });
  } catch {
    return false;
  }
}

async function maybeRefocusTerminalWindow(): Promise<void> {
  if (process.platform !== "darwin") return;
  if (process.env.COBUILD_CLI_DISABLE_TERMINAL_FOCUS === "1") return;

  const appCandidates =
    process.env.TERM_PROGRAM === "iTerm.app"
      ? ["iTerm2", "iTerm"]
      : process.env.TERM_PROGRAM === "Apple_Terminal"
        ? ["Terminal"]
        : process.env.TERM_PROGRAM === "WarpTerminal"
          ? ["Warp"]
          : process.env.TERM_PROGRAM === "WezTerm"
            ? ["WezTerm"]
            : [];

  for (const appName of appCandidates) {
    if (await activateTerminalApp(appName)) {
      return;
    }
  }
}

function printSetupWizardIntro(deps: Pick<CliDeps, "stderr">): void {
  deps.stderr("");
  deps.stderr("================================");
  deps.stderr("CLI Setup Wizard");
  deps.stderr("================================");
  deps.stderr("This wizard will save your CLI config and verify wallet access.");
}

function printSetupStep(deps: Pick<CliDeps, "stderr">, step: number, total: number, title: string): void {
  deps.stderr("");
  deps.stderr(`[${step}/${total}] ${title}`);
}

function printSetupSuccessSummary(params: {
  deps: Pick<CliDeps, "stderr">;
  configPath: string;
  defaultNetwork: string;
  walletAddress: string | null;
  x402?: SetupCommandOutput["x402"];
  linkStatus: GlobalLinkStatus;
}): void {
  params.deps.stderr("");
  params.deps.stderr("Setup complete.");
  params.deps.stderr(`Config saved: ${params.configPath}`);
  if (params.walletAddress) {
    params.deps.stderr(`Wallet address: ${params.walletAddress}`);
  }
  params.deps.stderr(`Default network: ${params.defaultNetwork}`);
  if (params.x402) {
    params.deps.stderr(`x402 payer mode: ${params.x402.mode}`);
    if (params.x402.payerAddress) {
      params.deps.stderr(`x402 payer address: ${params.x402.payerAddress}`);
    }
  }
  params.deps.stderr("");
  params.deps.stderr("Next:");
  params.deps.stderr("  cli wallet");
  params.deps.stderr("  cli send usdc 0.10 <to> (or cli send eth 0.00001 <to>)");
  if (params.linkStatus === "not-requested") {
    params.deps.stderr(
      "If cli is not on your PATH, run `pnpm link --global` once (or use: pnpm start -- <command>)."
    );
  }
}

function redactApprovalUrlForDisplay(value: string): string {
  try {
    const url = new URL(value);
    if (!url.hash) return url.toString();
    url.hash = "#<redacted>";
    return url.toString();
  } catch {
    return value;
  }
}

async function maybeOpenInterface(
  openUrl: string,
  displayUrl: string,
  deps: CliDeps
): Promise<boolean> {
  deps.stderr(`Opening ${displayUrl} in your browser...`);

  let opened = false;
  if (deps.openExternal) {
    try {
      opened = await deps.openExternal(openUrl);
    } catch {
      opened = false;
    }
  }

  if (!opened) {
    deps.stderr("Could not open a browser automatically.");
    deps.stderr(`Open this URL manually: ${openUrl}`);
    return false;
  }

  deps.stderr("Browser opened.");
  return true;
}

type SetupValueSource = "flag" | "config" | "env" | "default" | "interactive";

type SetupOutputMode = "legacy" | "structured";

async function requestTokenViaBrowser(params: {
  interfaceUrl: string;
  agent: string;
  network: string;
  deps: CliDeps;
}): Promise<string | null> {
  const { interfaceUrl, agent, network, deps } = params;
  const expectedOrigin = new URL(interfaceUrl).origin;

  let session: Awaited<ReturnType<typeof createSetupApprovalSession>> | null = null;
  try {
    session = await createSetupApprovalSession({ expectedOrigin });
  } catch (error) {
    deps.stderr(`Could not initialize secure setup channel (${getErrorMessage(error)}).`);
    return null;
  }

  try {
    const approvalUrl = buildSetupApprovalUrl({
      baseUrl: interfaceUrl,
      callbackUrl: session.callbackUrl,
      state: session.state,
      network,
      agent,
    });
    const approvalUrlForDisplay = redactApprovalUrlForDisplay(approvalUrl);

    deps.stderr("Approve token generation in the browser to continue.");
    const opened = await maybeOpenInterface(approvalUrl, approvalUrlForDisplay, deps);
    if (!opened) {
      deps.stderr(`If a browser did not open, visit: ${approvalUrl}`);
    }
    deps.stderr("Waiting for secure approval...");

    const token = await session.waitForToken;
    deps.stderr("Approval received from browser.");
    await maybeRefocusTerminalWindow();
    return token;
  } catch (error) {
    deps.stderr(`Browser approval did not complete (${getErrorMessage(error)}).`);
    return null;
  } finally {
    await session.close();
  }
}

async function promptLine(question: string, defaultValue?: string): Promise<string> {
  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const suffix = defaultValue ? ` (${defaultValue})` : "";
    const answer = (await rl.question(`${question}${suffix}: `)).trim();
    return answer || defaultValue || "";
  } finally {
    rl.close();
  }
}

async function promptSecret(question: string): Promise<string> {
  if (!process.stdin.isTTY) {
    throw new Error("Cannot prompt for token without a TTY. Pass --token <pat> instead.");
  }

  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const stderr = process.stderr;
    stderr.write(`${question}: `);

    let value = "";

    const cleanup = () => {
      stdin.off("data", onData);
      try {
        stdin.setRawMode(false);
      } catch {
        // ignore cleanup errors
      }
      stdin.pause();
    };

    const onData = (chunk: Buffer | string) => {
      const str = chunk.toString("utf8");
      for (const ch of str) {
        if (ch === "\n" || ch === "\r") {
          cleanup();
          stderr.write("\n");
          resolve(value.trim());
          return;
        }
        if (ch === "\u0003") {
          cleanup();
          stderr.write("\n");
          reject(new Error("Setup cancelled"));
          return;
        }
        if (ch === "\u007f") {
          value = value.slice(0, -1);
          continue;
        }
        value += ch;
      }
    };

    try {
      stdin.setRawMode(true);
      stdin.resume();
      stdin.on("data", onData);
    } catch (error) {
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
/* c8 ignore stop */

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
  if (input.x402PrivateKeyStdin && input.x402PrivateKeyFile) {
    throw new Error(`${SETUP_USAGE}\nProvide only one of --x402-private-key-stdin or --x402-private-key-file.`);
  }

  let requestedX402Mode = normalizeSetupX402Mode(input.x402Mode);
  if (requestedX402Mode !== "local-key" && (input.x402PrivateKeyStdin || input.x402PrivateKeyFile)) {
    throw new Error(
      `${SETUP_USAGE}\n--x402-private-key-stdin/--x402-private-key-file require --x402-mode local-key.`
    );
  }

  const current = readConfig(deps);
  const jsonMode = isJsonModeEnabled(input.json, deps);
  const interactive = isInteractive(deps) && !jsonMode;

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
  let defaultNetwork = "base-sepolia";
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
    printSetupStep(deps, 1, 4, "Interface URL");
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
    printSetupStep(deps, 2, 4, "Personal Access Token");
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
    const browserToken = await requestTokenViaBrowser({
      interfaceUrl: url,
      agent,
      network: defaultNetwork,
      deps,
    });
    if (browserToken) {
      token = browserToken;
    }
    if (!token) {
      deps.stderr("Falling back to manual token entry.");
      deps.stderr("Tip: paste from clipboard instead of using --token in shell history.");
      token = await promptSecret("CLI PAT token (input hidden)");
    }
    /* c8 ignore stop */
  } else {
    /* c8 ignore start */
    if (interactive) {
      if (tokenFromOption !== undefined) {
        deps.stderr("Using a PAT provided on this command.");
      } else {
        deps.stderr("Using an existing PAT from your config.");
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
    printSetupStep(deps, 3, 4, "Save config + bootstrap wallet");
  }
  /* c8 ignore stop */

  const path = configPath(deps);
  const nextConfig = persistPatToken({
    deps,
    config: {
      ...current,
      url,
      chatApiUrl,
      agent,
    },
    token,
    interfaceUrl: url,
  });
  writeConfig(deps, nextConfig);
  if (!jsonMode && outputMode === "legacy") {
    deps.stderr(`Saved config: ${path}`);
  }
  let walletResponse: unknown;
  try {
    walletResponse = await apiPost(deps, "/api/buildbot/wallet", {
      agentKey: agent,
      defaultNetwork,
    });
  } catch (error) {
    if (isAuthFailure(error)) {
      let cleanupSucceeded = true;
      try {
        clearPersistedPatToken(deps);
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

  let x402: SetupCommandOutput["x402"] | undefined;
  let x402StepShown = false;
  let x402ModeSelectedInteractively = false;
  const canPromptForX402Selection = interactive && Boolean(process.stdin.isTTY && process.stderr.isTTY);
  if (!requestedX402Mode && canPromptForX402Selection) {
    /* c8 ignore start */
    printSetupStep(deps, 4, 4, "Farcaster x402 payer (optional)");
    x402StepShown = true;
    requestedX402Mode = await promptSetupX402Mode(deps);
    x402ModeSelectedInteractively = true;
    /* c8 ignore stop */
  }

  if (requestedX402Mode && requestedX402Mode !== "skip") {
    if (interactive && !x402StepShown) {
      /* c8 ignore start */
      printSetupStep(deps, 4, 4, "Farcaster x402 payer (optional)");
      /* c8 ignore stop */
    }
    let x402Result: unknown;
    try {
      x402Result = await executeFarcasterX402InitCommand(
        {
          agent,
          mode: requestedX402Mode,
          privateKeyStdin: input.x402PrivateKeyStdin,
          privateKeyFile: input.x402PrivateKeyFile,
          noPrompt: !interactive,
        },
        deps
      );
    } catch (error) {
      if (!x402ModeSelectedInteractively) {
        throw error;
      }
      deps.stderr(`Skipped optional x402 setup (${getErrorMessage(error)}).`);
      deps.stderr(
        `Run later: cli farcaster x402 init --agent ${agent} --mode hosted|local-generate|local-key`
      );
    }

    if (x402Result !== undefined) {
      x402 = parseSetupX402Result(x402Result);
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
    ...(x402 ? { x402 } : {}),
    next: [
      "Run: cli wallet",
      "Run: cli send usdc 0.10 <to> (or cli send eth 0.00001 <to>)",
      ...(x402 ? [`Run: cli farcaster x402 status --agent ${agent}`] : []),
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
      x402,
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
