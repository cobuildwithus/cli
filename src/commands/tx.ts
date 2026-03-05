import { readConfig } from "../config.js";
import { apiPost } from "../transport.js";
import type { CliDeps } from "../types.js";
import {
  buildIdempotencyHeaders,
  normalizeEvmAddress,
  readJsonInputObject,
  resolveAgentKey,
  resolveExecIdempotencyKey,
  resolveNetwork,
  throwWithIdempotencyKey,
  validateHexData,
  validateNonNegativeDecimal,
  withIdempotencyKey,
} from "./shared.js";
import { executeLocalTx } from "../wallet/local-exec.js";
import { executeWithConfiguredWallet } from "../wallet/payer-config.js";

const TX_USAGE =
  "Usage: cli tx --to <address> --data <hex> [--value] [--network] [--agent] [--idempotency-key] [--dry-run] [--input-json <json>|--input-file <path>|--input-stdin]";

export interface TxCommandInput {
  to?: string;
  data?: string;
  value?: string;
  network?: string;
  agent?: string;
  idempotencyKey?: string;
  dryRun?: boolean;
  inputJson?: string;
  inputFile?: string;
  inputStdin?: boolean;
}

export interface TxCommandOutput extends Record<string, unknown> {
  idempotencyKey: string;
}

function readRequiredStringFromInputJson(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`tx input "${key}" must be a non-empty string.`);
  }
  return value.trim();
}

function readOptionalStringFromInputJson(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`tx input "${key}" must be a non-empty string when provided.`);
  }
  return value.trim();
}

async function resolveTxInput(
  input: TxCommandInput,
  deps: Pick<CliDeps, "fs" | "readStdin">
): Promise<{
  to: string;
  data: string;
  value?: string;
  network?: string;
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
      usage: TX_USAGE,
      valueLabel: "tx input",
    },
    deps
  );

  if (!inputJson) {
    if (!input.to || !input.data) {
      throw new Error(TX_USAGE);
    }
    return {
      to: input.to,
      data: input.data,
      value: input.value,
      network: input.network,
      agent: input.agent,
      idempotencyKey: input.idempotencyKey,
    };
  }

  const hasConflictingOptions =
    input.to !== undefined ||
    input.data !== undefined ||
    input.value !== undefined ||
    input.network !== undefined ||
    input.agent !== undefined ||
    input.idempotencyKey !== undefined;
  if (hasConflictingOptions) {
    throw new Error(
      `${TX_USAGE}\nDo not combine --input-json, --input-file, or --input-stdin with tx flags.`
    );
  }

  return {
    to: readRequiredStringFromInputJson(inputJson, "to"),
    data: readRequiredStringFromInputJson(inputJson, "data"),
    value: readOptionalStringFromInputJson(inputJson, "value"),
    network: readOptionalStringFromInputJson(inputJson, "network"),
    agent: readOptionalStringFromInputJson(inputJson, "agent"),
    idempotencyKey: readOptionalStringFromInputJson(inputJson, "idempotencyKey"),
  };
}

export async function executeTxCommand(input: TxCommandInput, deps: CliDeps): Promise<TxCommandOutput> {
  const resolvedInput = await resolveTxInput(input, deps);
  const data = resolvedInput.data;
  const normalizedTo = normalizeEvmAddress(resolvedInput.to, "--to");
  validateHexData(data, "--data");

  const valueEth = resolvedInput.value ?? "0";
  validateNonNegativeDecimal(valueEth, "--value");

  const current = readConfig(deps);
  const agentKey = resolveAgentKey(resolvedInput.agent, current.agent);
  const network = resolveNetwork(resolvedInput.network, deps);
  const idempotencyKey = resolveExecIdempotencyKey(resolvedInput.idempotencyKey, deps);
  const requestBody = {
    kind: "tx",
    network,
    agentKey,
    to: normalizedTo,
    data,
    valueEth,
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
    } as TxCommandOutput;
  }

  const response = await executeWithConfiguredWallet({
    deps,
    currentConfig: current,
    agentKey,
    onLocal: async ({ privateKeyHex }) => {
      try {
        return await executeLocalTx({
          deps,
          agentKey,
          privateKeyHex,
          network,
          to: normalizedTo,
          valueEth,
          data,
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

  return withIdempotencyKey(idempotencyKey, response) as TxCommandOutput;
}
