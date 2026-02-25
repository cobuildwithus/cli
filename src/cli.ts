import { handleConfigCommand } from "./commands/config.js";
import { handleDocsCommand } from "./commands/docs.js";
import { handleSendCommand } from "./commands/send.js";
import { handleSetupCommand } from "./commands/setup.js";
import { handleToolsCommand } from "./commands/tools.js";
import { handleTxCommand } from "./commands/tx.js";
import { handleWalletCommand } from "./commands/wallet.js";
import { defaultDeps } from "./deps.js";
import type { CliDeps } from "./types.js";
import { printUsage } from "./usage.js";

export function createCliDeps(overrides: Partial<CliDeps> = {}): CliDeps {
  return {
    ...defaultDeps,
    ...overrides,
  };
}

export async function runCli(argv: string[], deps: CliDeps): Promise<void> {
  const args = [...argv];
  if (args[0] === "--") {
    args.shift();
  }

  const command = args[0];
  if (!command || command === "--help" || command === "-h") {
    printUsage(deps);
    return;
  }

  if (command === "setup") {
    await handleSetupCommand(args.slice(1), deps);
    return;
  }

  if (command === "config") {
    await handleConfigCommand(args.slice(1), deps);
    return;
  }

  if (command === "wallet") {
    await handleWalletCommand(args.slice(1), deps);
    return;
  }

  if (command === "docs") {
    await handleDocsCommand(args.slice(1), deps);
    return;
  }

  if (command === "send") {
    await handleSendCommand(args.slice(1), deps);
    return;
  }

  if (command === "tx") {
    await handleTxCommand(args.slice(1), deps);
    return;
  }

  if (command === "tools") {
    await handleToolsCommand(args.slice(1), deps);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

export async function runCliFromProcess(
  processArgv: string[] = process.argv,
  overrides: Partial<CliDeps> = {}
): Promise<void> {
  const deps = createCliDeps(overrides);

  try {
    await runCli(processArgv.slice(2), deps);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.stderr(`Error: ${message}`);
    deps.exit(1);
  }
}
