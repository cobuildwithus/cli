import { readConfig } from "../config.js";
import { apiPost } from "../transport.js";
import type { CliDeps } from "../types.js";
import {
  buildIdempotencyHeaders,
  normalizeEvmAddress,
  parseIntegerOption,
  readJsonInputObject,
  resolveAgentKey,
  resolveExecIdempotencyKey,
  resolveNetwork,
  throwWithIdempotencyKey,
  validateNonNegativeDecimal,
  withIdempotencyKey,
} from "./shared.js";
import { executeLocalTransfer } from "../wallet/local-exec.js";
import { executeWithConfiguredWallet } from "../wallet/payer-config.js";

const SEND_USAGE =
  "Usage: cli send <token> <amount> <to> [--network] [--decimals] [--agent] [--idempotency-key] [--dry-run] [--input-json <json>|--input-file <path>|--input-stdin]";

export interface SendCommandInput {
  token?: string;
  amount?: string;
  to?: string;
  network?: string;
  decimals?: string;
  agent?: string;
  idempotencyKey?: string;
  dryRun?: boolean;
  inputJson?: string;
  inputFile?: string;
  inputStdin?: boolean;
}

export interface SendCommandOutput extends Record<string, unknown> {
  idempotencyKey: string;
}

function readRequiredStringFromInputJson(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`send input "${key}" must be a non-empty string.`);
  }
  return value.trim();
}

function readOptionalStringFromInputJson(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`send input "${key}" must be a non-empty string when provided.`);
  }
  return value.trim();
}

function readOptionalDecimalsFromInputJson(payload: Record<string, unknown>): string | undefined {
  const value = payload.decimals;
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "number") {
    if (!Number.isInteger(value)) {
      throw new Error('send input "decimals" must be an integer.');
    }
    return String(value);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  throw new Error('send input "decimals" must be a string or integer.');
}

async function resolveSendInput(
  input: SendCommandInput,
  deps: Pick<CliDeps, "fs" | "readStdin">
): Promise<{
  token: string;
  amount: string;
  to: string;
  network?: string;
  decimals?: string;
  agent?: string;
  idempotencyKey?: string;
}> {
  const inputJson = await readJsonInputObject(
    {
      json: input.inputJson,
      file: input.inputFile,
      stdin: input.inputStdin,
      jsonFlag: "--input-json",
      fileFlag: "--input-file",
      stdinFlag: "--input-stdin",
      usage: SEND_USAGE,
      valueLabel: "send input",
    },
    deps
  );

  if (!inputJson) {
    if (!input.token || !input.amount || !input.to) {
      throw new Error(SEND_USAGE);
    }
    return {
      token: input.token,
      amount: input.amount,
      to: input.to,
      network: input.network,
      decimals: input.decimals,
      agent: input.agent,
      idempotencyKey: input.idempotencyKey,
    };
  }

  const hasConflictingOptions =
    input.token !== undefined ||
    input.amount !== undefined ||
    input.to !== undefined ||
    input.network !== undefined ||
    input.decimals !== undefined ||
    input.agent !== undefined ||
    input.idempotencyKey !== undefined;
  if (hasConflictingOptions) {
    throw new Error(
      `${SEND_USAGE}\nDo not combine --input-json, --input-file, or --input-stdin with positional arguments or send flags.`
    );
  }

  return {
    token: readRequiredStringFromInputJson(inputJson, "token"),
    amount: readRequiredStringFromInputJson(inputJson, "amount"),
    to: readRequiredStringFromInputJson(inputJson, "to"),
    network: readOptionalStringFromInputJson(inputJson, "network"),
    decimals: readOptionalDecimalsFromInputJson(inputJson),
    agent: readOptionalStringFromInputJson(inputJson, "agent"),
    idempotencyKey: readOptionalStringFromInputJson(inputJson, "idempotencyKey"),
  };
}

export async function executeSendCommand(input: SendCommandInput, deps: CliDeps): Promise<SendCommandOutput> {
  const resolvedInput = await resolveSendInput(input, deps);
  const token = resolvedInput.token;
  const amount = resolvedInput.amount;
  const to = resolvedInput.to;

  const decimals = parseIntegerOption(resolvedInput.decimals, "--decimals");
  if (decimals !== undefined && (decimals < 0 || decimals > 255)) {
    throw new Error("--decimals must be between 0 and 255");
  }
  validateNonNegativeDecimal(amount, "amount");
  const normalizedTo = normalizeEvmAddress(to, "to");

  const current = readConfig(deps);
  const agentKey = resolveAgentKey(resolvedInput.agent, current.agent);
  const network = resolveNetwork(resolvedInput.network, deps);
  const idempotencyKey = resolveExecIdempotencyKey(resolvedInput.idempotencyKey, deps);
  const requestBody = {
    kind: "transfer",
    network,
    agentKey,
    token,
    amount,
    to: normalizedTo,
    ...(decimals !== undefined ? { decimals } : {}),
  };

  if (input.dryRun === true) {
    return {
      ok: true,
      dryRun: true,
      idempotencyKey,
      request: {
        method: "POST",
        path: "/api/cli/exec",
        body: requestBody,
      },
    } as SendCommandOutput;
  }

  const response = await executeWithConfiguredWallet({
    deps,
    currentConfig: current,
    agentKey,
    onLocal: async ({ privateKeyHex }) => {
      try {
        return await executeLocalTransfer({
          deps,
          agentKey,
          privateKeyHex,
          network,
          token,
          amount,
          to: normalizedTo,
          decimals,
          idempotencyKey,
        });
      } catch (error) {
        throwWithIdempotencyKey(error, idempotencyKey);
      }
    },
    onHosted: async () => {
      try {
        return await apiPost(
          deps,
          "/api/cli/exec",
          requestBody,
          {
            headers: buildIdempotencyHeaders(idempotencyKey),
          }
        );
      } catch (error) {
        throwWithIdempotencyKey(error, idempotencyKey);
      }
    },
  });

  return withIdempotencyKey(idempotencyKey, response) as SendCommandOutput;
}
