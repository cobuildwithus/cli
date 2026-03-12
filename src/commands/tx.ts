import type { CliDeps } from "../types.js";
import {
  normalizeEvmAddress,
  validateHexData,
  validateNonNegativeDecimal,
} from "./shared.js";
import {
  readOptionalStringFromInputJson,
  readRequiredStringFromInputJson,
  resolveJsonOrFlagInput,
} from "./input-validation.js";
import {
  executeWalletWriteCommand,
} from "./wallet-write-shared.js";
import { executeLocalTx } from "../wallet/local-exec.js";

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
  return await resolveJsonOrFlagInput({
    input,
    deps,
    usage: TX_USAGE,
    valueLabel: "tx input",
    hasConflictingOptions:
      input.to !== undefined ||
      input.data !== undefined ||
      input.value !== undefined ||
      input.network !== undefined ||
      input.agent !== undefined ||
      input.idempotencyKey !== undefined,
    conflictMessage: "Do not combine --input-json, --input-file, or --input-stdin with tx flags.",
    resolveFlags: () => {
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
    },
    resolveJson: (payload) => ({
      to: readRequiredStringFromInputJson(payload, "to", "tx input"),
      data: readRequiredStringFromInputJson(payload, "data", "tx input"),
      value: readOptionalStringFromInputJson(payload, "value", "tx input"),
      network: readOptionalStringFromInputJson(payload, "network", "tx input"),
      agent: readOptionalStringFromInputJson(payload, "agent", "tx input"),
      idempotencyKey: readOptionalStringFromInputJson(payload, "idempotencyKey", "tx input"),
    }),
  });
}

export async function executeTxCommand(input: TxCommandInput, deps: CliDeps): Promise<TxCommandOutput> {
  const resolvedInput = await resolveTxInput(input, deps);
  const data = resolvedInput.data;
  const normalizedTo = normalizeEvmAddress(resolvedInput.to, "--to");
  validateHexData(data, "--data");

  const valueEth = resolvedInput.value ?? "0";
  validateNonNegativeDecimal(valueEth, "--value");

  return executeWalletWriteCommand<TxCommandOutput>({
    deps,
    input: {
      ...resolvedInput,
      dryRun: input.dryRun,
    },
    buildRequestBody: (execution) => ({
      kind: "tx",
      network: execution.network,
      agentKey: execution.agentKey,
      to: normalizedTo,
      data,
      valueEth,
    }),
    onLocal: ({ privateKeyHex, execution }) =>
      executeLocalTx({
        deps,
        agentKey: execution.agentKey,
        privateKeyHex,
        network: execution.network,
        to: normalizedTo,
        valueEth,
        data,
        idempotencyKey: execution.idempotencyKey,
      }),
  });
}
