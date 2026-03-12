import { Cli, z } from "incur";
import {
  executeWalletCommand,
  executeWalletInitCommand,
  executeWalletStatusCommand,
} from "../../commands/wallet.js";
import type { CliDeps } from "../../types.js";
import { mapOptionsToExecutor } from "./command-wrapper-shared.js";

export function registerWalletCommand(root: Cli.Cli, deps: CliDeps): void {
  const walletConfigOutput = z.object({
    mode: z.enum(["hosted", "local"]),
    walletAddress: z.string().nullable(),
    network: z.string(),
    token: z.string(),
    costPerPaidCallMicroUsdc: z.string().optional(),
  });
  const walletOutput = z
    .object({
      ok: z.boolean().optional(),
      address: z.string().optional(),
      agentKey: z.string().optional(),
      walletConfig: walletConfigOutput.optional(),
    })
    .passthrough();
  const walletOptions = z.object({
    network: z.string().optional(),
    agent: z.string().optional(),
    mode: z.string().optional(),
    privateKeyStdin: z.boolean().optional(),
    privateKeyFile: z.string().optional(),
    prompt: z.boolean().optional(),
  });
  const runWallet = mapOptionsToExecutor(
    deps,
    executeWalletCommand,
    (options: z.infer<typeof walletOptions>) => ({
      network: options.network,
      agent: options.agent,
    })
  );
  const runWalletStatus = mapOptionsToExecutor(
    deps,
    executeWalletStatusCommand,
    (options: z.infer<typeof walletOptions>) => ({
      agent: options.agent,
    })
  );
  const runWalletInit = mapOptionsToExecutor(
    deps,
    executeWalletInitCommand,
    (options: z.infer<typeof walletOptions>) => ({
      agent: options.agent,
      mode: options.mode,
      privateKeyStdin: options.privateKeyStdin,
      privateKeyFile: options.privateKeyFile,
      noPrompt: options.prompt === false,
    })
  );

  root.command("wallet", {
    description: "Fetch wallet details and manage wallet configuration",
    args: z.object({
      action: z.string().optional(),
    }),
    options: walletOptions,
    output: walletOutput,
    run(context) {
      const action = context.args.action?.trim().toLowerCase();

      if (action === undefined) {
        return runWallet(context) as Promise<z.infer<typeof walletOutput>>;
      }

      if (action === "status") {
        return runWalletStatus(context) as Promise<z.infer<typeof walletOutput>>;
      }

      if (action === "init") {
        return runWalletInit(context) as Promise<z.infer<typeof walletOutput>>;
      }

      throw new Error(
        "Usage:\n  cli wallet [status] [--network <network>] [--agent <key>]\n  cli wallet init [--agent <key>] [--mode hosted|local-generate|local-key] [--private-key-stdin|--private-key-file <path>] [--no-prompt]"
      );
    },
  });
}
