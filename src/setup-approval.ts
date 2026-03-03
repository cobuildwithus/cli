import { randomBytes } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import {
  buildCliAuthorizeUrl,
  CLI_OAUTH_REDIRECT_PATH,
  type CliSetupWalletModeHint,
} from "./oauth.js";

const LOOPBACK_HOST = "127.0.0.1";
const DEFAULT_TIMEOUT_MS = 5 * 60_000;
const SETUP_STATE_PATTERN = /^[A-Za-z0-9_-]{32,200}$/;
const AUTH_CODE_PATTERN = /^[A-Za-z0-9._~-]{20,1024}$/;
const CALLBACK_PATH = CLI_OAUTH_REDIRECT_PATH;

export type SetupApprovalSession = {
  state: string;
  callbackUrl: string;
  waitForCode: Promise<string>;
  close: () => Promise<void>;
};

export type SetupApprovalSessionParams = {
  timeoutMs?: number;
  state?: string;
  postAuthRedirectUrl?: string;
};

function createSetupState(): string {
  return randomBytes(24).toString("base64url");
}

export function isValidSetupState(value: string): boolean {
  return SETUP_STATE_PATTERN.test(value);
}

function isValidAuthorizationCode(value: string): boolean {
  return AUTH_CODE_PATTERN.test(value);
}

function closeServer(server: Server): Promise<void> {
  if (!server.listening) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

function writeHtml(res: ServerResponse<IncomingMessage>, status: number, html: string): void {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(html);
}

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function successPageHtml(postAuthRedirectUrl?: string): string {
  const escapedRedirectUrl = postAuthRedirectUrl ? escapeHtml(postAuthRedirectUrl) : undefined;
  const redirectMeta = postAuthRedirectUrl
    ? `<meta http-equiv="refresh" content="1;url=${escapedRedirectUrl}"/>`
    : "";
  const redirectScript = postAuthRedirectUrl
    ? `<script>setTimeout(function(){window.location.assign(${JSON.stringify(postAuthRedirectUrl)});}, 200);</script>`
    : "";
  const redirectMessage = postAuthRedirectUrl
    ? [
      "<p>Returning you to Cobuild...</p>",
      `<p><a href="${escapedRedirectUrl}">Continue to Cobuild</a></p>`,
    ].join("")
    : "";

  return [
    "<!doctype html>",
    `<html><head><meta charset="utf-8"/>${redirectMeta}<title>CLI setup complete</title></head>`,
    "<body style=\"font-family: sans-serif; padding: 24px;\">",
    "<h1>CLI authorization complete</h1>",
    "<p>You can return to your terminal and finish setup.</p>",
    redirectMessage,
    redirectScript,
    "</body></html>",
  ].join("");
}

function errorPageHtml(message: string): string {
  const escapedMessage = escapeHtml(message);
  return [
    "<!doctype html>",
    "<html><head><meta charset=\"utf-8\"/><title>CLI setup failed</title></head>",
    "<body style=\"font-family: sans-serif; padding: 24px;\">",
    "<h1>CLI authorization failed</h1>",
    `<p>${escapedMessage}</p>`,
    "</body></html>",
  ].join("");
}

export function buildSetupApprovalUrl(params: {
  baseUrl: string;
  callbackUrl: string;
  state: string;
  agent: string;
  codeChallenge: string;
  scope: string;
  label?: string;
  walletMode?: CliSetupWalletModeHint;
}): string {
  if (!isValidSetupState(params.state)) {
    throw new Error("Invalid setup state");
  }

  return buildCliAuthorizeUrl({
    interfaceUrl: params.baseUrl,
    redirectUri: params.callbackUrl,
    state: params.state,
    scope: params.scope,
    codeChallenge: params.codeChallenge,
    agentKey: params.agent,
    ...(params.label ? { label: params.label } : {}),
    ...(params.walletMode ? { walletMode: params.walletMode } : {}),
  });
}

export async function createSetupApprovalSession(
  params: SetupApprovalSessionParams = {}
): Promise<SetupApprovalSession> {
  const timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const state = params.state ?? createSetupState();

  if (!isValidSetupState(state)) {
    throw new Error("Invalid setup state");
  }

  const server = createServer();
  let settled = false;
  let closed = false;
  let resolveCode: ((code: string) => void) | null = null;
  let rejectCode: ((error: Error) => void) | null = null;

  const waitForCode = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });

  const finishWithError = (error: Error) => {
    if (settled) return;
    settled = true;
    rejectCode?.(error);
    void close();
  };

  const finishWithCode = (code: string) => {
    if (settled) return;
    settled = true;
    resolveCode?.(code);
    void close();
  };

  const timeoutId = setTimeout(() => {
    finishWithError(new Error("Timed out waiting for browser approval"));
  }, timeoutMs);
  timeoutId.unref?.();

  const close = async () => {
    if (closed) return;
    closed = true;
    clearTimeout(timeoutId);
    await closeServer(server);
    if (!settled) {
      settled = true;
      rejectCode?.(new Error("Setup approval session closed"));
    }
  };

  server.on("request", (req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", `http://${LOOPBACK_HOST}`);

      if (url.pathname !== CALLBACK_PATH) {
        writeHtml(res, 404, errorPageHtml("Not found."));
        return;
      }
      if (req.method !== "GET") {
        writeHtml(res, 405, errorPageHtml("Method not allowed."));
        return;
      }

      const receivedState = url.searchParams.get("state");
      const code = url.searchParams.get("code");
      if (!receivedState || receivedState !== state) {
        writeHtml(res, 400, errorPageHtml("State did not match this setup session."));
        return;
      }
      if (!code || !isValidAuthorizationCode(code)) {
        writeHtml(res, 400, errorPageHtml("Authorization code was missing or invalid."));
        return;
      }

      writeHtml(res, 200, successPageHtml(params.postAuthRedirectUrl));
      finishWithCode(code);
    })().catch((error) => {
      const message = error instanceof Error ? error.message : "Unexpected callback error";
      writeHtml(res, 500, errorPageHtml(message));
      finishWithError(new Error(message));
    });
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(0, LOOPBACK_HOST);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    await close();
    throw new Error("Failed to bind setup approval server");
  }

  const callbackUrl = `http://${LOOPBACK_HOST}:${address.port}${CALLBACK_PATH}`;
  return {
    state,
    callbackUrl,
    waitForCode,
    close,
  };
}
