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

  if (!parsed.values.to || !parsed.values.data) {
    throw new Error(TX_USAGE);
  }
  validateEvmAddress(parsed.values.to, "--to");
  validateHexData(parsed.values.data, "--data");

  const valueEth = parsed.values.value ?? "0";
  validateNonNegativeDecimal(valueEth, "--value");

  const current = readConfig(deps);
  const agentKey = resolveAgentKey(parsed.values.agent, current.agent);
  const network = resolveNetwork(parsed.values.network);
  const idempotencyKey = resolveExecIdempotencyKey(parsed.values["idempotency-key"], deps);

  let response: unknown;
  try {
    response = await apiPost(
      deps,
      "/api/buildbot/exec",
      {
        kind: "tx",
        network,
        agentKey,
        to: parsed.values.to,
        data: parsed.values.data,
        valueEth,
      },
      {
        headers: buildIdempotencyHeaders(idempotencyKey),
      }
    );
  } catch (error) {
    throwWithIdempotencyKey(error, idempotencyKey);
  }

  printJson(deps, withIdempotencyKey(idempotencyKey, response));
}
