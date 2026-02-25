import type { CliDeps } from "../types.js";
import { asRecord } from "../transport.js";

export function normalizeTokenInput(token: string): string {
  return token.trim();
}

export function countTokenSources(values: {
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

export function readTokenFromFile(tokenFile: string, deps: Pick<CliDeps, "fs">): string {
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

export async function readTokenFromStdin(deps: Pick<CliDeps, "readStdin">): Promise<string> {
  if (deps.readStdin) {
    const token = normalizeTokenInput(await deps.readStdin());
    if (!token) {
      throw new Error("Token stdin input is empty.");
    }
    return token;
  }

  /* c8 ignore start */
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
  /* c8 ignore stop */
}

export function resolveAgentKey(inputAgent: string | undefined, configAgent: string | undefined): string {
  return inputAgent || configAgent || "default";
}

const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuidV4(value: string): boolean {
  return UUID_V4_REGEX.test(value);
}

export function resolveExecIdempotencyKey(inputKey: string | undefined, deps: Pick<CliDeps, "randomUUID">): string {
  const key = inputKey ?? deps.randomUUID();
  if (!isUuidV4(key)) {
    throw new Error("Idempotency key must be a UUID v4 (e.g. 8e03978e-40d5-43e8-bc93-6894a57f9324)");
  }
  return key;
}

export function resolveNetwork(inputNetwork: string | undefined): string {
  return inputNetwork || process.env.BUILD_BOT_NETWORK || "base-sepolia";
}

export function parseIntegerOption(value: string | undefined, optionName: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!/^-?\d+$/.test(value)) {
    throw new Error(`${optionName} must be an integer`);
  }
  return Number.parseInt(value, 10);
}

export function buildIdempotencyHeaders(idempotencyKey: string): Record<string, string> {
  return {
    "X-Idempotency-Key": idempotencyKey,
    "Idempotency-Key": idempotencyKey,
  };
}

export function withIdempotencyKey(idempotencyKey: string, response: unknown): Record<string, unknown> {
  return {
    ...asRecord(response),
    idempotencyKey,
  };
}
