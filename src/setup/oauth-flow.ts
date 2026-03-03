/* v8 ignore file */
import {
  CLI_OAUTH_DEFAULT_SCOPE,
  createPkcePair,
  exchangeAuthorizationCode,
} from "../oauth.js";
import { buildSetupApprovalUrl, createSetupApprovalSession } from "../setup-approval.js";
import type { CliDeps } from "../types.js";
import { resolveInterfaceSetupCompleteUrl, type SetupWalletMode } from "./env.js";

export function isAuthFailure(error: unknown): boolean {
  return error instanceof Error && /unauthorized|forbidden/i.test(error.message);
}

export function isGenericInternalFailure(error: unknown): boolean {
  return error instanceof Error && /\binternal error\b/i.test(error.message);
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

export function redactApprovalUrlForDisplay(value: string): string {
  try {
    const url = new URL(value);
    const sensitiveParams = new Set(["state", "code_challenge", "redirect_uri"]);
    for (const key of sensitiveParams) {
      if (url.searchParams.has(key)) {
        url.searchParams.set(key, "<redacted>");
      }
    }
    if (url.hash) {
      url.hash = "#<redacted>";
    }
    return url.toString();
  } catch {
    return value;
  }
}

async function maybeOpenInterface(
  openUrl: string,
  displayUrl: string,
  showApprovalUrl: boolean,
  deps: CliDeps
): Promise<boolean> {
  deps.stderr(`Opening ${displayUrl} in your browser...`);
  if (showApprovalUrl) {
    deps.stderr(`Approval URL: ${openUrl}`);
  }

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
    if (showApprovalUrl) {
      deps.stderr(`Open this URL manually: ${openUrl}`);
    } else {
      deps.stderr(`Open this URL manually: ${displayUrl}`);
      deps.stderr("Re-run with --show-approval-url to print the full approval URL.");
    }
    return false;
  }

  deps.stderr("Browser opened.");
  return true;
}

async function activateTerminalApp(appName: string): Promise<boolean> {
  try {
    const { spawn } = await import("node:child_process");

    return await new Promise((resolve) => {
      const child = spawn("osascript", ["-e", `tell application \"${appName}\" to activate`], {
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

async function requestAuthorizationCodeViaBrowser(params: {
  interfaceUrl: string;
  agent: string;
  scope: string;
  walletMode?: SetupWalletMode;
  showApprovalUrl?: boolean;
  deps: CliDeps;
}): Promise<{
  code: string;
  redirectUri: string;
  codeVerifier: string;
} | null> {
  const {
    interfaceUrl,
    agent,
    scope,
    walletMode,
    showApprovalUrl,
    deps,
  } = params;
  const { codeVerifier, codeChallenge } = await createPkcePair();

  let session: Awaited<ReturnType<typeof createSetupApprovalSession>> | null = null;
  try {
    session = await createSetupApprovalSession({
      postAuthRedirectUrl: resolveInterfaceSetupCompleteUrl({
        interfaceUrl,
        agent,
        walletMode,
      }),
    });
  } catch (error) {
    deps.stderr(`Could not initialize secure setup channel (${getErrorMessage(error)}).`);
    return null;
  }

  try {
    const approvalUrl = buildSetupApprovalUrl({
      baseUrl: interfaceUrl,
      callbackUrl: session.callbackUrl,
      state: session.state,
      agent,
      scope,
      codeChallenge,
      ...(walletMode ? { walletMode } : {}),
    });
    const approvalUrlForDisplay = redactApprovalUrlForDisplay(approvalUrl);

    deps.stderr("Approve CLI authorization in the browser to continue.");
    const opened = await maybeOpenInterface(
      approvalUrl,
      approvalUrlForDisplay,
      showApprovalUrl === true,
      deps
    );
    if (!opened) {
      deps.stderr("Waiting for browser authorization after manual URL handoff...");
    }
    deps.stderr("Waiting for browser authorization...");

    const code = await session.waitForCode;
    deps.stderr("Approval received from browser.");
    await maybeRefocusTerminalWindow();
    return {
      code,
      redirectUri: session.callbackUrl,
      codeVerifier,
    };
  } catch (error) {
    deps.stderr(`Browser approval did not complete (${getErrorMessage(error)}).`);
    return null;
  } finally {
    await session.close();
  }
}

export async function requestRefreshTokenViaBrowser(params: {
  interfaceUrl: string;
  chatApiUrl: string;
  agent: string;
  scope?: string;
  walletMode?: SetupWalletMode;
  showApprovalUrl?: boolean;
  deps: CliDeps;
}): Promise<string | null> {
  const browserAuthorization = await requestAuthorizationCodeViaBrowser({
    interfaceUrl: params.interfaceUrl,
    agent: params.agent,
    scope: params.scope ?? CLI_OAUTH_DEFAULT_SCOPE,
    walletMode: params.walletMode,
    showApprovalUrl: params.showApprovalUrl,
    deps: params.deps,
  });
  if (!browserAuthorization) {
    return null;
  }

  try {
    const exchanged = await exchangeAuthorizationCode({
      deps: params.deps,
      chatApiUrl: params.chatApiUrl,
      code: browserAuthorization.code,
      redirectUri: browserAuthorization.redirectUri,
      codeVerifier: browserAuthorization.codeVerifier,
    });
    return exchanged.refreshToken;
  } catch (error) {
    params.deps.stderr(`OAuth token exchange failed (${getErrorMessage(error)}).`);
    return null;
  }
}
