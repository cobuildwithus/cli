import type { CliDeps } from "../types.js";
import { asRecord } from "../transport.js";
import { getAddress, isAddress, isHex, type Address } from "viem";
import { isUuidV4 } from "../uuid.js";
import { isLoopbackHost, normalizeApiUrlInput } from "../url.js";

export type CliApiUrlLabel = "Interface URL" | "Chat API URL";

function getEnv(deps: Pick<CliDeps, "env">): NodeJS.ProcessEnv {
  return deps.env ?? process.env;
}

export function isLoopbackInterfaceHost(hostname: string): boolean {
  return isLoopbackHost(hostname);
}

export function normalizeApiUrl(rawValue: string, label: CliApiUrlLabel): string {
  return normalizeApiUrlInput(rawValue, label);
}

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

const NON_NEGATIVE_DECIMAL_REGEX = /^(0|[1-9]\d*)(\.\d+)?$/;

export function resolveExecIdempotencyKey(inputKey: string | undefined, deps: Pick<CliDeps, "randomUUID">): string {
  const key = inputKey ?? deps.randomUUID();
  if (!isUuidV4(key)) {
    throw new Error("Idempotency key must be a UUID v4 (e.g. 8e03978e-40d5-43e8-bc93-6894a57f9324)");
  }
  return key;
}

export function resolveNetwork(inputNetwork: string | undefined, deps: Pick<CliDeps, "env">): string {
  const envNetwork = getEnv(deps).COBUILD_CLI_NETWORK;
  return inputNetwork || envNetwork || "base-sepolia";
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

export function throwWithIdempotencyKey(error: unknown, idempotencyKey: string): never {
  const message = error instanceof Error ? error.message : String(error);
  throw new Error(`${message} (idempotency key: ${idempotencyKey})`);
}

export function normalizeEvmAddress(value: string, label: string): Address {
  if (!isAddress(value, { strict: false })) {
    throw new Error(`${label} must be a 20-byte hex address (0x + 40 hex chars)`);
  }
  return getAddress(value).toLowerCase() as Address;
}

export function validateEvmAddress(value: string, label: string): void {
  normalizeEvmAddress(value, label);
}

export function validateHexData(value: string, label: string): void {
  if (!isHex(value, { strict: true }) || value.length % 2 !== 0) {
    throw new Error(`${label} must be a hex string with even length (0x...)`);
  }
}

export function validateNonNegativeDecimal(value: string, label: string): void {
  if (!NON_NEGATIVE_DECIMAL_REGEX.test(value)) {
    throw new Error(`${label} must be a non-negative decimal string`);
  }
}
