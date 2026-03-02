import { parseArgs } from "node:util";
import { readConfig } from "../config.js";
import { printJson } from "../output.js";
import { apiPost } from "../transport.js";
import type { CliDeps } from "../types.js";
import { resolveAgentKey } from "./shared.js";

export interface WalletCommandInput {
  network?: string;
  agent?: string;
}

export async function executeWalletCommand(input: WalletCommandInput, deps: CliDeps): Promise<unknown> {
  const current = readConfig(deps);
  return await apiPost(deps, "/api/buildbot/wallet", {
    defaultNetwork: input.network,
    agentKey: resolveAgentKey(input.agent, current.agent),
  });
}

/* c8 ignore start */
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

  const output = await executeWalletCommand(
    {
      network: parsed.values.network,
      agent: parsed.values.agent,
    },
    deps
  );
  printJson(deps, output);
}
/* c8 ignore stop */
