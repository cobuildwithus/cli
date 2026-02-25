import { parseArgs } from "node:util";
import { readConfig } from "../config.js";
import { printJson } from "../output.js";
import { apiPost } from "../transport.js";
import type { CliDeps } from "../types.js";
import { resolveAgentKey } from "./shared.js";

export async function handleWalletCommand(args: string[], deps: CliDeps): Promise<void> {
  const parsed = parseArgs({
    options: {
      network: { type: "string" },
      agent: { type: "string" },
    },
    args,
    allowPositionals: false,
    strict: true,
  });

  const current = readConfig(deps);
  const response = await apiPost(deps, "/api/build-bot/wallet", {
    defaultNetwork: parsed.values.network,
    agentKey: resolveAgentKey(parsed.values.agent, current.agent),
  });

  printJson(deps, response);
}
