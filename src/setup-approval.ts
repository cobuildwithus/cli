import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

const LOOPBACK_HOST = "127.0.0.1";
const CALLBACK_PATH_PREFIX = "/api/build-bot/cli/callback/";
const DEFAULT_TIMEOUT_MS = 5 * 60_000;
const MAX_BODY_BYTES = 64 * 1024;
const SETUP_STATE_PATTERN = /^[A-Za-z0-9_-]{32,200}$/;
const LOOPBACK_ORIGIN_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

type ApprovalPayload = {
  state?: unknown;
  token?: unknown;
};

export type SetupApprovalSession = {
  state: string;
  callbackUrl: string;
  waitForToken: Promise<string>;
  close: () => Promise<void>;
};

export type SetupApprovalSessionParams = {
  expectedOrigin: string;
  timeoutMs?: number;
  state?: string;
};

function createSetupState(): string {
  return randomBytes(24).toString("base64url");
}

export function isValidSetupState(value: string): boolean {
  return SETUP_STATE_PATTERN.test(value);
}

function normalizeOriginHost(value: string): string {
  const lower = value.toLowerCase();
  return lower === "[::1]" ? "::1" : lower;
}

function resolvedOriginPort(url: URL): string {
  if (url.port) return url.port;
  return url.protocol === "https:" ? "443" : "80";
}

function isLoopbackOriginHost(value: string): boolean {
  return LOOPBACK_ORIGIN_HOSTS.has(normalizeOriginHost(value));
}

function resolveAllowedOrigin(
  receivedOrigin: string | null,
  expectedOrigin: URL
): string | null {
  if (!receivedOrigin) return null;

  let received: URL;
  try {
    received = new URL(receivedOrigin);
  } catch {
    return null;
  }

  if (received.protocol !== expectedOrigin.protocol) return null;
  if (resolvedOriginPort(received) !== resolvedOriginPort(expectedOrigin)) return null;

  const expectedHost = normalizeOriginHost(expectedOrigin.hostname);
  const receivedHost = normalizeOriginHost(received.hostname);

  if (isLoopbackOriginHost(expectedHost)) {
    return isLoopbackOriginHost(receivedHost) ? received.origin : null;
  }

  return received.origin === expectedOrigin.origin ? received.origin : null;
}

export function buildSetupApprovalUrl(params: {
  baseUrl: string;
  callbackUrl: string;
  state: string;
  network: string;
  agent: string;
}): string {
  if (!isValidSetupState(params.state)) {
    throw new Error("Invalid setup state");
  }

  const url = new URL("/home", params.baseUrl);
  url.searchParams.set("buildBotSetup", "1");
  url.searchParams.set("buildBotCallback", params.callbackUrl);
  url.searchParams.set("buildBotState", params.state);
  url.searchParams.set("buildBotNetwork", params.network);
  url.searchParams.set("buildBotAgent", params.agent);
  return url.toString();
}

function writeJson(
  res: ServerResponse<IncomingMessage>,
  status: number,
  body: Record<string, unknown>,
  origin?: string
): void {
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  };

  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Vary"] = "Origin";
  }

  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

function writePreflight(
  res: ServerResponse<IncomingMessage>,
  status: number,
  origin?: string
): void {
  const headers: Record<string, string> = {
    "Cache-Control": "no-store",
  };

  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Vary"] = "Origin";
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type";
    headers["Access-Control-Max-Age"] = "60";
  }

  res.writeHead(status, headers);
  res.end();
}

async function readJsonBody(
  req: IncomingMessage
): Promise<{ ok: true; payload: ApprovalPayload } | { ok: false; status: number; error: string }> {
  const chunks: Buffer[] = [];
  let total = 0;

  try {
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.length;
      if (total > MAX_BODY_BYTES) {
        return { ok: false, status: 413, error: "Payload too large" };
      }
      chunks.push(buffer);
    }
  } catch {
    return { ok: false, status: 400, error: "Failed to read request body" };
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return { ok: false, status: 400, error: "Missing request body" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, status: 400, error: "Invalid JSON body" };
  }

  if (!parsed || typeof parsed !== "object") {
    return { ok: false, status: 400, error: "Invalid JSON body" };
  }

  return { ok: true, payload: parsed as ApprovalPayload };
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

export async function createSetupApprovalSession(
  params: SetupApprovalSessionParams
): Promise<SetupApprovalSession> {
  const expectedOrigin = new URL(params.expectedOrigin);
  const timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const state = params.state ?? createSetupState();

  if (!isValidSetupState(state)) {
    throw new Error("Invalid setup state");
  }

  const callbackPath = `${CALLBACK_PATH_PREFIX}${state}`;
  const server = createServer();

  let settled = false;
  let closed = false;
  let resolveToken: ((token: string) => void) | null = null;
  let rejectToken: ((error: Error) => void) | null = null;

  const waitForToken = new Promise<string>((resolve, reject) => {
    resolveToken = resolve;
    rejectToken = reject;
  });

  const finishWithError = (error: Error) => {
    if (settled) return;
    settled = true;
    rejectToken?.(error);
    void close();
  };

  const finishWithToken = (token: string) => {
    if (settled) return;
    settled = true;
    resolveToken?.(token);
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
      rejectToken?.(new Error("Setup approval session closed"));
    }
  };

  server.on("request", (req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", `http://${LOOPBACK_HOST}`);
      const originHeader = typeof req.headers.origin === "string" ? req.headers.origin : null;
      const allowedOrigin = resolveAllowedOrigin(originHeader, expectedOrigin);

      if (url.pathname !== callbackPath) {
        writeJson(res, 404, { ok: false, error: "Not found" });
        return;
      }

      if (req.method === "OPTIONS") {
        if (!allowedOrigin) {
          writePreflight(res, 403);
          return;
        }
        writePreflight(res, 204, allowedOrigin);
        return;
      }

      if (req.method !== "POST") {
        writeJson(
          res,
          405,
          { ok: false, error: "Method not allowed" },
          allowedOrigin ?? undefined
        );
        return;
      }

      if (!allowedOrigin) {
        writeJson(res, 403, { ok: false, error: "Forbidden origin" });
        return;
      }

      const body = await readJsonBody(req);
      if (!body.ok) {
        writeJson(res, body.status, { ok: false, error: body.error }, allowedOrigin);
        return;
      }

      if (body.payload.state !== state) {
        writeJson(res, 400, { ok: false, error: "Invalid setup state" }, allowedOrigin);
        return;
      }

      if (typeof body.payload.token !== "string" || !body.payload.token.startsWith("bbt_")) {
        writeJson(res, 400, { ok: false, error: "Invalid token payload" }, allowedOrigin);
        return;
      }

      writeJson(res, 200, { ok: true }, allowedOrigin);
      finishWithToken(body.payload.token);
    })().catch((error) => {
      const message = error instanceof Error ? error.message : "Unexpected callback error";
      writeJson(res, 500, { ok: false, error: message });
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
    throw new Error("Failed to bind local approval callback server");
  }

  return {
    state,
    callbackUrl: `http://${LOOPBACK_HOST}:${address.port}${callbackPath}`,
    waitForToken,
    close,
  };
}
