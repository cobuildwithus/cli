import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { configPath, readConfig, writeConfig } from "../config.js";
import { printJson } from "../output.js";
import { buildSetupApprovalUrl, createSetupApprovalSession } from "../setup-approval.js";
import { apiPost } from "../transport.js";
import type { CliDeps } from "../types.js";

const SETUP_USAGE =
  "Usage: buildbot setup [--url <interface-url>] [--token <pat>] [--agent <key>] [--network <network>] [--json] [--link]";
const SETUP_AUTH_FAILURE_MESSAGE = [
  "PAT authorization failed while bootstrapping wallet access.",
  "The saved token was cleared to avoid reusing it.",
  "Run setup again and approve a fresh token in the browser.",
].join(" ");
const SETUP_BACKEND_FAILURE_MESSAGE = [
  "Wallet bootstrap failed on the interface server.",
  "Check interface logs, run the Build Bot SQL migrations, and verify CDP env vars are set",
  "(CDP_API_KEY_ID, CDP_API_KEY_SECRET, CDP_WALLET_SECRET).",
].join(" ");
const BUILD_BOT_PACKAGE_NAME = "@cobuildwithus/build-bot";
const SETUP_PNPM_PATH_HINT =
  "Auto-link skipped: unable to locate a trusted pnpm entrypoint for this shell session. Run manually: pnpm link --global";

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
  key: "BUILD_BOT_OUTPUT" | "BUILD_BOT_URL" | "BUILD_BOT_NETWORK"
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

function isJsonModeEnabled(value: unknown, deps: Pick<CliDeps, "env">): boolean {
  if (value === true) return true;
  return getNonEmptyEnvValue(deps, "BUILD_BOT_OUTPUT")?.toLowerCase() === "json";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function getSetupWalletAddress(walletResponse: unknown): string | null {
  const responseRecord = asRecord(walletResponse);
  const walletRecord = responseRecord ? asRecord(responseRecord.wallet) : null;
  return walletRecord && typeof walletRecord.address === "string" ? walletRecord.address : null;
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
        if (parsedPackage.name === BUILD_BOT_PACKAGE_NAME) {
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

async function maybeLinkBuildBotGlobalCommand(
  deps: Pick<CliDeps, "env" | "runSetupLinkGlobal" | "stdout">,
  shouldLink: boolean
): Promise<GlobalLinkStatus> {
  if (!shouldLink) return "not-requested";

  const setupPackageRoot = resolveSetupPackageRoot();
  if (!setupPackageRoot) {
    deps.stdout("Auto-link skipped: could not determine the buildbot package root.");
    deps.stdout("Run manually: pnpm link --global");
    return "skipped";
  }

  const pnpmExecPath = resolveTrustedPnpmExecPath(deps);
  if (!pnpmExecPath) {
    deps.stdout(SETUP_PNPM_PATH_HINT);
    return "skipped";
  }

  deps.stdout("Installing global `buildbot` command via pnpm link...");
  const linkResult = await runPnpmLinkGlobal({
    deps,
    cwd: setupPackageRoot,
    pnpmExecPath,
  });
  if (linkResult.ok) {
    deps.stdout("Global command installed. You can now run `buildbot ...` directly.");
    return "linked";
  }

  const normalizedOutput = linkResult.output.toLowerCase();
  if (
    normalizedOutput.includes("err_pnpm_no_global_bin_dir") ||
    normalizedOutput.includes("unable to find the global bin directory")
  ) {
    deps.stdout("Auto-link failed: pnpm global bin directory is not configured.");
    deps.stdout("Run once: pnpm setup");
    deps.stdout("Then restart your shell and run: pnpm link --global");
    deps.stdout("Until then, run commands via: pnpm start -- <command>");
    return "failed";
  }

  const firstLine = firstNonEmptyLine(linkResult.output);
  if (firstLine) deps.stdout(`Auto-link failed: ${firstLine}`);
  deps.stdout("Auto-link failed. Run manually: pnpm link --global");
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
  if (process.env.BUILD_BOT_DISABLE_TERMINAL_FOCUS === "1") return;

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

function clearSavedToken(deps: Pick<CliDeps, "fs" | "homedir">): void {
  const current = readConfig(deps);
  if (!current.token) return;
  const { token: _token, ...next } = current;
  writeConfig(deps, next);
}

function printSetupWizardIntro(deps: Pick<CliDeps, "stdout">): void {
  deps.stdout("");
  deps.stdout("================================");
  deps.stdout("Build Bot Setup Wizard");
  deps.stdout("================================");
  deps.stdout("This wizard will save your CLI config and verify wallet access.");
}

function printSetupStep(deps: Pick<CliDeps, "stdout">, step: number, title: string): void {
  deps.stdout("");
  deps.stdout(`[${step}/3] ${title}`);
}

function printSetupSuccessSummary(params: {
  deps: Pick<CliDeps, "stdout">;
  configPath: string;
  defaultNetwork: string;
  walletAddress: string | null;
  linkStatus: GlobalLinkStatus;
}): void {
  params.deps.stdout("");
  params.deps.stdout("Setup complete.");
  params.deps.stdout(`Config saved: ${params.configPath}`);
  if (params.walletAddress) {
    params.deps.stdout(`Wallet address: ${params.walletAddress}`);
  }
  params.deps.stdout(`Default network: ${params.defaultNetwork}`);
  params.deps.stdout("");
  params.deps.stdout("Next:");
  params.deps.stdout("  buildbot wallet");
  params.deps.stdout("  buildbot send usdc 0.10 <to> (or buildbot send eth 0.00001 <to>)");
  if (params.linkStatus === "not-requested") {
    params.deps.stdout(
      "If buildbot is not on your PATH, run `pnpm link --global` once (or use: pnpm start -- <command>)."
    );
  }
}

async function maybeOpenInterface(url: string, deps: CliDeps): Promise<void> {
  deps.stdout(`Opening ${url} in your browser...`);

  let opened = false;
  if (deps.openExternal) {
    try {
      opened = await deps.openExternal(url);
    } catch {
      opened = false;
    }
  }

  if (!opened) {
    deps.stdout("Could not open a browser automatically.");
    deps.stdout(`Open this URL manually: ${url}`);
    return;
  }

  deps.stdout("Browser opened.");
}

type SetupValueSource = "flag" | "config" | "env" | "default" | "interactive";

function normalizeTokenInput(token: string): string {
  return token.trim();
}

function countTokenSources(values: {
  token?: string;
  tokenFile?: string;
  tokenStdin?: boolean;
}): number {
  let count = 0;
  if (typeof values.token === "string") count += 1;
  if (typeof values.tokenFile === "string") count += 1;
  if (values.tokenStdin === true) count += 1;
  return count;
}

function readTokenFromFile(tokenFile: string, deps: Pick<CliDeps, "fs">): string {
  let rawToken: string;
  try {
    rawToken = deps.fs.readFileSync(tokenFile, "utf8");
  } catch (error) {
    throw new Error(
      `Could not read token file: ${tokenFile} (${error instanceof Error ? error.message : String(error)})`
    );
  }

  const token = normalizeTokenInput(rawToken);
  if (!token) {
    throw new Error(`Token file is empty: ${tokenFile}`);
  }

  return token;
}

async function readTokenFromStdin(deps: Pick<CliDeps, "readStdin">): Promise<string> {
  if (deps.readStdin) {
    const token = normalizeTokenInput(await deps.readStdin());
    if (!token) {
      throw new Error("Token stdin input is empty.");
    }
    return token;
  }

  if (process.stdin.isTTY) {
    throw new Error("Refusing --token-stdin from an interactive TTY. Pipe token bytes into stdin.");
  }

  const stdin = process.stdin;
  stdin.setEncoding("utf8");
  const raw = await new Promise<string>((resolve, reject) => {
    let buffer = "";
    stdin.on("data", (chunk: string) => {
      buffer += chunk;
    });
    stdin.once("end", () => resolve(buffer));
    stdin.once("error", reject);
  });

  const token = normalizeTokenInput(raw);
  if (!token) {
    throw new Error("Token stdin input is empty.");
  }
  return token;
}

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
    deps.stdout(`Could not initialize secure setup channel (${getErrorMessage(error)}).`);
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

    deps.stdout("Approve token generation in the browser to continue.");
    await maybeOpenInterface(approvalUrl, deps);
    deps.stdout(`If a browser did not open, visit: ${approvalUrl}`);
    deps.stdout("Waiting for secure approval...");

    const token = await session.waitForToken;
    deps.stdout("Approval received from browser.");
    await maybeRefocusTerminalWindow();
    return token;
  } catch (error) {
    deps.stdout(`Browser approval did not complete (${getErrorMessage(error)}).`);
    return null;
  } finally {
    await session.close();
  }
}

async function promptLine(question: string, defaultValue?: string): Promise<string> {
  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
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
    const stdout = process.stdout;
    stdout.write(`${question}: `);

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
          stdout.write("\n");
          resolve(value.trim());
          return;
        }
        if (ch === "\u0003") {
          cleanup();
          stdout.write("\n");
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

export async function handleSetupCommand(args: string[], deps: CliDeps): Promise<void> {
  const parsed = parseArgs({
    options: {
      url: { type: "string" },
      token: { type: "string" },
      "token-file": { type: "string" },
      "token-stdin": { type: "boolean" },
      agent: { type: "string" },
      network: { type: "string" },
      json: { type: "boolean" },
      link: { type: "boolean" },
    },
    args,
    allowPositionals: false,
    strict: true,
  });

  const tokenSourceCount = countTokenSources({
    token: parsed.values.token,
    tokenFile: parsed.values["token-file"],
    tokenStdin: parsed.values["token-stdin"],
  });
  if (tokenSourceCount > 1) {
    throw new Error(`${SETUP_USAGE}\nProvide only one of --token, --token-file, or --token-stdin.`);
  }

  const current = readConfig(deps);
  const jsonMode = isJsonModeEnabled(parsed.values.json, deps);
  const interactive = isInteractive(deps) && !jsonMode;

  const storedUrl = typeof current.url === "string" ? current.url.trim() : "";
  const storedToken = typeof current.token === "string" ? current.token.trim() : "";
  const envUrl = getNonEmptyEnvValue(deps, "BUILD_BOT_URL");
  const envNetwork = getNonEmptyEnvValue(deps, "BUILD_BOT_NETWORK");

  let urlSource: SetupValueSource = "default";
  let url: string | undefined;
  if (typeof parsed.values.url === "string") {
    url = parsed.values.url;
    urlSource = "flag";
  } else if (storedUrl) {
    url = storedUrl;
    urlSource = "config";
  } else if (envUrl) {
    url = envUrl;
    urlSource = "env";
  }

  let tokenFromOption: string | undefined;
  if (typeof parsed.values.token === "string") {
    tokenFromOption = normalizeTokenInput(parsed.values.token);
  } else if (typeof parsed.values["token-file"] === "string") {
    tokenFromOption = readTokenFromFile(parsed.values["token-file"], deps);
  } else if (parsed.values["token-stdin"] === true) {
    tokenFromOption = await readTokenFromStdin(deps);
  }
  if (tokenFromOption !== undefined && tokenFromOption.length === 0) {
    throw new Error("Token cannot be empty");
  }

  const defaultAgent = current.agent || "default";
  let networkSource: SetupValueSource = "default";
  let defaultNetwork = "base-sepolia";
  if (typeof parsed.values.network === "string") {
    defaultNetwork = parsed.values.network;
    networkSource = "flag";
  } else if (envNetwork) {
    defaultNetwork = envNetwork;
    networkSource = "env";
  }

  let token = tokenFromOption ?? (storedToken || undefined);
  const agent = parsed.values.agent || defaultAgent;

  /* c8 ignore start */
  if (interactive) {
    printSetupWizardIntro(deps);
  }
  /* c8 ignore stop */

  /* c8 ignore start */
  if (interactive) {
    printSetupStep(deps, 1, "Interface URL");
  }
  /* c8 ignore stop */

  if (!url) {
    if (!interactive) {
      throw new Error(`${SETUP_USAGE}\nMissing --url and no config found.`);
    }
    /* c8 ignore start */
    url = await promptLine("Interface URL", "http://localhost:3000");
    urlSource = "interactive";
    /* c8 ignore stop */
  } else {
    /* c8 ignore start */
    if (interactive) {
      if (urlSource === "env") {
        deps.stdout(`Using interface URL from BUILD_BOT_URL: ${url}`);
      } else {
        deps.stdout(`Using: ${url}`);
      }
    }
    /* c8 ignore stop */
  }

  /* c8 ignore start */
  if (interactive) {
    printSetupStep(deps, 2, "Personal Access Token");
  }
  /* c8 ignore stop */

  /* c8 ignore start */
  if (interactive && networkSource === "env") {
    deps.stdout(`Using default network from BUILD_BOT_NETWORK: ${defaultNetwork}`);
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
      deps.stdout("Falling back to manual token entry.");
      deps.stdout("Tip: paste from clipboard instead of using --token in shell history.");
      token = await promptSecret("Build Bot PAT token (input hidden)");
    }
    /* c8 ignore stop */
  } else {
    /* c8 ignore start */
    if (interactive) {
      if (tokenFromOption !== undefined) {
        deps.stdout("Using a PAT provided on this command.");
      } else {
        deps.stdout("Using an existing PAT from your config.");
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
    printSetupStep(deps, 3, "Save config + bootstrap wallet");
  }
  /* c8 ignore stop */

  const path = configPath(deps);
  writeConfig(deps, { url, token, agent });
  if (!jsonMode) {
    deps.stdout(`Saved config: ${path}`);
  }
  let walletResponse: unknown;
  try {
    walletResponse = await apiPost(deps, "/api/build-bot/wallet", {
      agentKey: agent,
      defaultNetwork,
    });
  } catch (error) {
    if (isAuthFailure(error)) {
      clearSavedToken(deps);
      throw new Error(SETUP_AUTH_FAILURE_MESSAGE);
    }
    if (isGenericInternalFailure(error)) {
      throw new Error(SETUP_BACKEND_FAILURE_MESSAGE);
    }
    throw error;
  }

  const successPayload = {
    ok: true,
    config: { url, agent, path },
    defaultNetwork,
    wallet: walletResponse,
    next: [
      "Run: buildbot wallet",
      "Run: buildbot send usdc 0.10 <to> (or buildbot send eth 0.00001 <to>)",
    ],
  };

  const linkStatus = jsonMode
    ? "not-requested"
    : await maybeLinkBuildBotGlobalCommand(deps, parsed.values.link === true);

  if (jsonMode || !interactive) {
    printJson(deps, successPayload);
    return;
  }

  printSetupSuccessSummary({
    deps,
    configPath: path,
    defaultNetwork,
    walletAddress: getSetupWalletAddress(walletResponse),
    linkStatus,
  });
}
