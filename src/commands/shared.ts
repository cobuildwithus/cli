import type { CliDeps } from "../types.js";
import { asRecord } from "../transport.js";
import {
  normalizeEvmAddress as normalizeWireEvmAddress,
  parseBaseOnlyNetwork,
} from "@cobuild/wire";
import { isHex, type Address } from "viem";
import {
  buildIdempotencyRequestHeaders,
  IDEMPOTENCY_KEY_VALIDATION_ERROR,
  isIdempotencyKey,
} from "../idempotency-contract.js";

const CONTROL_CHARS_REGEX = /[\u0000-\u001f\u007f-\u009f]/;
const SAFE_PATH_SEGMENT_REGEX = /^[A-Za-z0-9._-]+$/;
const MAX_AGENT_KEY_LENGTH = 64;

function getEnv(deps: Pick<CliDeps, "env">): NodeJS.ProcessEnv {
  return deps.env ?? process.env;
}

export function normalizeTokenInput(token: string): string {
  return token.trim();
}

export function rejectControlChars(label: string, value: string): string {
  if (CONTROL_CHARS_REGEX.test(value)) {
    throw new Error(`${label} must not contain control characters.`);
  }
  return value;
}

export function validateSafePathSegment(label: string, value: string): string {
  if (value === "." || value === "..") {
    throw new Error(`${label} must not be "." or "..".`);
  }
  if (value.includes("/") || value.includes("\\")) {
    throw new Error(`${label} must not contain path separators.`);
  }
  return value;
}

export function validateAgentKey(value: string, label = "--agent"): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} cannot be empty.`);
  }
  if (trimmed.length > MAX_AGENT_KEY_LENGTH) {
    throw new Error(`${label} must be at most ${MAX_AGENT_KEY_LENGTH} characters.`);
  }
  rejectControlChars(label, trimmed);
  validateSafePathSegment(label, trimmed);
  if (!SAFE_PATH_SEGMENT_REGEX.test(trimmed)) {
    throw new Error(`${label} may only contain letters, numbers, ".", "_", and "-".`);
  }
  return trimmed;
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

function countJsonSources(values: {
  json?: string;
  file?: string;
  stdin?: boolean;
}): number {
  let count = 0;
  if (typeof values.json === "string") count += 1;
  if (typeof values.file === "string") count += 1;
  if (values.stdin === true) count += 1;
  return count;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

async function readTextFromStdin(
  deps: Pick<CliDeps, "readStdin">,
  emptyErrorMessage: string,
  interactiveErrorMessage: string
): Promise<string> {
  if (deps.readStdin) {
    const value = await deps.readStdin();
    if (value.trim().length === 0) {
      throw new Error(emptyErrorMessage);
    }
    return value;
  }

  /* c8 ignore start */
  if (process.stdin.isTTY) {
    throw new Error(interactiveErrorMessage);
  }

  const stdin = process.stdin;
  stdin.setEncoding("utf8");
  const value = await new Promise<string>((resolve, reject) => {
    let buffer = "";
    stdin.on("data", (chunk: string) => {
      buffer += chunk;
    });
    stdin.once("end", () => resolve(buffer));
    stdin.once("error", reject);
  });
  if (value.trim().length === 0) {
    throw new Error(emptyErrorMessage);
  }
  return value;
  /* c8 ignore stop */
}

export async function readTokenFromStdin(deps: Pick<CliDeps, "readStdin">): Promise<string> {
  const raw = await readTextFromStdin(
    deps,
    "Token stdin input is empty.",
    "Refusing --token-stdin from an interactive TTY. Pipe token bytes into stdin."
  );
  return normalizeTokenInput(raw);
}

function readTextFromFile(path: string, label: string, deps: Pick<CliDeps, "fs">): string {
  try {
    return deps.fs.readFileSync(path, "utf8");
  } catch (error) {
    throw new Error(
      `Could not read ${label} ${path}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function parseJsonObject(rawJson: string, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch (error) {
    throw new Error(`${label} must be valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(parsed)) {
    throw new Error(`${label} must decode to a JSON object.`);
  }
  return parsed;
}

export interface JsonInputOptions {
  json?: string;
  file?: string;
  stdin?: boolean;
  jsonFlag: string;
  fileFlag: string;
  stdinFlag: string;
  usage: string;
  valueLabel: string;
}

export async function readJsonInputObject(
  options: JsonInputOptions,
  deps: Pick<CliDeps, "fs" | "readStdin">
): Promise<Record<string, unknown> | undefined> {
  const count = countJsonSources({
    json: options.json,
    file: options.file,
    stdin: options.stdin,
  });
  if (count > 1) {
    throw new Error(
      `${options.usage}\nProvide only one of ${options.fileFlag}, ${options.jsonFlag}, or ${options.stdinFlag}.`
    );
  }

  let rawJson: string | undefined;
  if (typeof options.file === "string") {
    rawJson = readTextFromFile(options.file, options.fileFlag, deps);
  } else if (typeof options.json === "string") {
    rawJson = options.json;
  } else if (options.stdin === true) {
    rawJson = await readTextFromStdin(
      deps,
      `${options.stdinFlag} input is empty.`,
      `Refusing ${options.stdinFlag} from an interactive TTY. Pipe JSON bytes into stdin.`
    );
  }

  if (rawJson === undefined) {
    return undefined;
  }
  if (rawJson.trim().length === 0) {
    throw new Error(`${options.valueLabel} cannot be empty.`);
  }
  return parseJsonObject(rawJson, options.valueLabel);
}

export function resolveAgentKey(inputAgent: string | undefined, configAgent: string | undefined): string {
  if (inputAgent !== undefined) {
    return validateAgentKey(inputAgent, "agent key");
  }
  if (configAgent !== undefined) {
    return validateAgentKey(configAgent, "agent key");
  }
  return "default";
}

const NON_NEGATIVE_DECIMAL_REGEX = /^(0|[1-9]\d*)(\.\d+)?$/;

export function resolveExecIdempotencyKey(inputKey: string | undefined, deps: Pick<CliDeps, "randomUUID">): string {
  const key = inputKey ?? deps.randomUUID();
  if (!isIdempotencyKey(key)) {
    throw new Error(IDEMPOTENCY_KEY_VALIDATION_ERROR);
  }
  return key;
}

export function resolveNetwork(inputNetwork: string | undefined, deps: Pick<CliDeps, "env">): string {
  const envNetwork = getEnv(deps).COBUILD_CLI_NETWORK;
  const rawNetwork = inputNetwork ?? envNetwork ?? "base";
  const normalized = parseBaseOnlyNetwork(rawNetwork);
  if (normalized) {
    return normalized;
  }

  throw new Error(`Unsupported network "${rawNetwork}". Only "base" is supported.`);
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
  return buildIdempotencyRequestHeaders(idempotencyKey);
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
  try {
    return normalizeWireEvmAddress(value, label) as Address;
  } catch (error) {
    if (error instanceof Error && error.message.includes("must be a valid 20-byte hex address")) {
      throw new Error(`${label} must be a 20-byte hex address (0x + 40 hex chars)`);
    }
    throw error;
  }
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
