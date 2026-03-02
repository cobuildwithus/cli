import { parseArgs } from "node:util";
import { readConfig } from "../config.js";
import { printJson } from "../output.js";
import { apiPost } from "../transport.js";
import type { CliDeps } from "../types.js";
import {
  buildIdempotencyHeaders,
  parseIntegerOption,
  resolveAgentKey,
  resolveExecIdempotencyKey,
  resolveNetwork,
  throwWithIdempotencyKey,
  validateEvmAddress,
  validateNonNegativeDecimal,
  withIdempotencyKey,
} from "./shared.js";

const SEND_USAGE =
  "Usage: cli send <token> <amount> <to> [--network] [--decimals] [--agent] [--idempotency-key]";

export interface SendCommandInput {
  token?: string;
  amount?: string;
  to?: string;
  network?: string;
  decimals?: string;
  agent?: string;
  idempotencyKey?: string;
}

export async function executeSendCommand(input: SendCommandInput, deps: CliDeps): Promise<Record<string, unknown>> {
  const token = input.token;
  const amount = input.amount;
  const to = input.to;
  if (!token || !amount || !to) {
    throw new Error(SEND_USAGE);
  }

  const decimals = parseIntegerOption(input.decimals, "--decimals");
  if (decimals !== undefined && (decimals < 0 || decimals > 255)) {
    throw new Error("--decimals must be between 0 and 255");
  }
  validateNonNegativeDecimal(amount, "amount");
  validateEvmAddress(to, "to");

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
        kind: "transfer",
        network,
        agentKey,
        token,
        amount,
        to,
        decimals,
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
export async function handleSendCommand(args: string[], deps: CliDeps): Promise<void> {
  const parsed = parseArgs({
    options: {
      network: { type: "string" },
      decimals: { type: "string" },
      agent: { type: "string" },
      "idempotency-key": { type: "string" },
    },
    args,
    allowPositionals: true,
    strict: true,
  });

  const output = await executeSendCommand(
    {
      token: parsed.positionals[0],
      amount: parsed.positionals[1],
      to: parsed.positionals[2],
      network: parsed.values.network,
      decimals: parsed.values.decimals,
      agent: parsed.values.agent,
      idempotencyKey: parsed.values["idempotency-key"],
    },
    deps
  );
  printJson(deps, output);
}
/* c8 ignore stop */
