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
  withIdempotencyKey,
} from "./shared.js";

const SEND_USAGE =
  "Usage: buildbot send <token> <amount> <to> [--network] [--decimals] [--agent] [--idempotency-key]";

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

  const [token, amount, to] = parsed.positionals;
  if (!token || !amount || !to) {
    throw new Error(SEND_USAGE);
  }

  const decimals = parseIntegerOption(parsed.values.decimals, "--decimals");
  if (decimals !== undefined && (decimals < 0 || decimals > 255)) {
    throw new Error("--decimals must be between 0 and 255");
  }
  const current = readConfig(deps);
  const agentKey = resolveAgentKey(parsed.values.agent, current.agent);
  const network = resolveNetwork(parsed.values.network);
  const idempotencyKey = resolveExecIdempotencyKey(parsed.values["idempotency-key"], deps);

  const response = await apiPost(
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

  printJson(deps, withIdempotencyKey(idempotencyKey, response));
}
