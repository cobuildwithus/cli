import type { CliDeps } from "../types.js";
import {
  normalizeEvmAddress,
  parseIntegerOption,
  validateNonNegativeDecimal,
  withIdempotencyKey,
} from "./shared.js";
import {
  readOptionalStringFromInputJson,
  readOptionalStringOrIntegerFromInputJson,
  readRequiredStringFromInputJson,
  resolveJsonOrFlagInput,
} from "./input-validation.js";
import {
  buildExecDryRunOutput,
  executeWalletWrite,
  resolveWalletWriteExecutionContext,
} from "./wallet-write-shared.js";
import { executeLocalTransfer } from "../wallet/local-exec.js";

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
  return await resolveJsonOrFlagInput({
    input,
    deps,
    usage: SEND_USAGE,
    valueLabel: "send input",
    hasConflictingOptions:
      input.token !== undefined ||
      input.amount !== undefined ||
      input.to !== undefined ||
      input.network !== undefined ||
      input.decimals !== undefined ||
      input.agent !== undefined ||
      input.idempotencyKey !== undefined,
    conflictMessage:
      "Do not combine --input-json, --input-file, or --input-stdin with positional arguments or send flags.",
    resolveFlags: () => {
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
    },
    resolveJson: (payload) => ({
      token: readRequiredStringFromInputJson(payload, "token", "send input"),
      amount: readRequiredStringFromInputJson(payload, "amount", "send input"),
      to: readRequiredStringFromInputJson(payload, "to", "send input"),
      network: readOptionalStringFromInputJson(payload, "network", "send input"),
      decimals: readOptionalStringOrIntegerFromInputJson(payload, "decimals", "send input"),
      agent: readOptionalStringFromInputJson(payload, "agent", "send input"),
      idempotencyKey: readOptionalStringFromInputJson(payload, "idempotencyKey", "send input"),
    }),
  });
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

  const execution = resolveWalletWriteExecutionContext(resolvedInput, deps);
  const requestBody = {
    kind: "transfer",
    network: execution.network,
    agentKey: execution.agentKey,
    token,
    amount,
    to: normalizedTo,
    ...(decimals !== undefined ? { decimals } : {}),
  };

  if (input.dryRun === true) {
    return buildExecDryRunOutput({
      idempotencyKey: execution.idempotencyKey,
      requestBody,
    }) as SendCommandOutput;
  }

  const response = await executeWalletWrite({
    deps,
    context: execution,
    requestBody,
    onLocal: async ({ privateKeyHex }) => {
      return await executeLocalTransfer({
        deps,
        agentKey: execution.agentKey,
        privateKeyHex,
        network: execution.network,
        token,
        amount,
        to: normalizedTo,
        decimals,
        idempotencyKey: execution.idempotencyKey,
      });
    },
  });

  return withIdempotencyKey(execution.idempotencyKey, response) as SendCommandOutput;
}
