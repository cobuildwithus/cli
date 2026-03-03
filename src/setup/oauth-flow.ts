/* v8 ignore file */
import {
  createPkcePair,
  exchangeAuthorizationCode,
  OAUTH_DEFAULT_SCOPE,
} from "../oauth.js";
import { buildSetupApprovalUrl, createSetupApprovalSession } from "../setup-approval.js";
import type { CliDeps } from "../types.js";
import { resolveInterfaceSetupCompleteUrl, type SetupPayerMode } from "./env.js";

export function isAuthFailure(error: unknown): boolean {
  return error instanceof Error && /unauthorized|forbidden/i.test(error.message);
}

export function isGenericInternalFailure(error: unknown): boolean {
  return error instanceof Error && /\binternal error\b/i.test(error.message);
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
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
  payerMode?: SetupPayerMode;
  deps: CliDeps;
}): Promise<{
  code: string;
  redirectUri: string;
  codeVerifier: string;
} | null> {
  const {
    interfaceUrl,
    agent,
    payerMode,
    deps,
  } = params;
  const { codeVerifier, codeChallenge } = createPkcePair();

  let session: Awaited<ReturnType<typeof createSetupApprovalSession>> | null = null;
  try {
    session = await createSetupApprovalSession({
      postAuthRedirectUrl: resolveInterfaceSetupCompleteUrl({
        interfaceUrl,
        agent,
        payerMode,
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
      scope: OAUTH_DEFAULT_SCOPE,
      codeChallenge,
      ...(payerMode ? { payerMode } : {}),
    });
    const approvalUrlForDisplay = redactApprovalUrlForDisplay(approvalUrl);

    deps.stderr("Approve CLI authorization in the browser to continue.");
    const opened = await maybeOpenInterface(approvalUrl, approvalUrlForDisplay, deps);
    if (!opened) {
      deps.stderr(`If a browser did not open, visit: ${approvalUrl}`);
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
  payerMode?: SetupPayerMode;
  deps: CliDeps;
}): Promise<string | null> {
  const browserAuthorization = await requestAuthorizationCodeViaBrowser({
    interfaceUrl: params.interfaceUrl,
    agent: params.agent,
    payerMode: params.payerMode,
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
