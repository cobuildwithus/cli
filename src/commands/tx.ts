import { readConfig } from "../config.js";
import { apiPost } from "../transport.js";
import type { CliDeps } from "../types.js";
import {
  buildIdempotencyHeaders,
  normalizeEvmAddress,
  resolveAgentKey,
  resolveExecIdempotencyKey,
  resolveNetwork,
  throwWithIdempotencyKey,
  validateHexData,
  validateNonNegativeDecimal,
  withIdempotencyKey,
} from "./shared.js";

const TX_USAGE =
  "Usage: cli tx --to <address> --data <hex> [--value] [--network] [--agent] [--idempotency-key]";

export interface TxCommandInput {
  to?: string;
  data?: string;
  value?: string;
  network?: string;
  agent?: string;
  idempotencyKey?: string;
}

export interface TxCommandOutput extends Record<string, unknown> {
  idempotencyKey: string;
}

export async function executeTxCommand(input: TxCommandInput, deps: CliDeps): Promise<TxCommandOutput> {
  if (!input.to || !input.data) {
    throw new Error(TX_USAGE);
  }
  const normalizedTo = normalizeEvmAddress(input.to, "--to");
  validateHexData(input.data, "--data");

  const valueEth = input.value ?? "0";
  validateNonNegativeDecimal(valueEth, "--value");

  const current = readConfig(deps);
  const agentKey = resolveAgentKey(input.agent, current.agent);
  const network = resolveNetwork(input.network, deps);
  const idempotencyKey = resolveExecIdempotencyKey(input.idempotencyKey, deps);

  let response: unknown;
  try {
    response = await apiPost(
      deps,
      "/api/cli/exec",
      {
        kind: "tx",
        network,
        agentKey,
        to: normalizedTo,
        data: input.data,
        valueEth,
      },
      {
        headers: buildIdempotencyHeaders(idempotencyKey),
      }
    );
  } catch (error) {
    throwWithIdempotencyKey(error, idempotencyKey);
  }

  return withIdempotencyKey(idempotencyKey, response) as TxCommandOutput;
}
