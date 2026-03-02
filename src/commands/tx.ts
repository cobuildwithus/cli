import { parseArgs } from "node:util";
import { readConfig } from "../config.js";
import { printJson } from "../output.js";
import { apiPost } from "../transport.js";
import type { CliDeps } from "../types.js";
import {
  buildIdempotencyHeaders,
  resolveAgentKey,
  resolveExecIdempotencyKey,
  resolveNetwork,
  throwWithIdempotencyKey,
  validateEvmAddress,
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

export async function executeTxCommand(input: TxCommandInput, deps: CliDeps): Promise<Record<string, unknown>> {
  if (!input.to || !input.data) {
    throw new Error(TX_USAGE);
  }
  validateEvmAddress(input.to, "--to");
  validateHexData(input.data, "--data");

  const valueEth = input.value ?? "0";
  validateNonNegativeDecimal(valueEth, "--value");

  const current = readConfig(deps);
  const agentKey = resolveAgentKey(input.agent, current.agent);
  const network = resolveNetwork(input.network);
  const idempotencyKey = resolveExecIdempotencyKey(input.idempotencyKey, deps);

  let response: unknown;
  try {
    response = await apiPost(
      deps,
      "/api/buildbot/exec",
      {
        kind: "tx",
        network,
        agentKey,
        to: input.to,
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

  return withIdempotencyKey(idempotencyKey, response);
}

/* c8 ignore start */
export async function handleTxCommand(args: string[], deps: CliDeps): Promise<void> {
  const parsed = parseArgs({
    options: {
      to: { type: "string" },
      data: { type: "string" },
      value: { type: "string" },
      network: { type: "string" },
      agent: { type: "string" },
      "idempotency-key": { type: "string" },
    },
    args,
    allowPositionals: false,
    strict: true,
  });

  const output = await executeTxCommand(
    {
      to: parsed.values.to,
      data: parsed.values.data,
      value: parsed.values.value,
      network: parsed.values.network,
      agent: parsed.values.agent,
      idempotencyKey: parsed.values["idempotency-key"],
    },
    deps
  );
  printJson(deps, output);
}
/* c8 ignore stop */
