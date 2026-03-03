import { Cli, z } from "incur";
import {
  executeWalletCommand,
  executeWalletInitCommand,
  executeWalletStatusCommand,
} from "../../commands/wallet.js";
import type { CliDeps } from "../../types.js";

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

  root.command("wallet", {
    description: "Fetch wallet details and manage wallet configuration",
    args: z.object({
      action: z.string().optional(),
    }),
    options: z.object({
      network: z.string().optional(),
      agent: z.string().optional(),
      mode: z.string().optional(),
      privateKeyStdin: z.boolean().optional(),
      privateKeyFile: z.string().optional(),
      prompt: z.boolean().optional(),
    }),
    output: walletOutput,
    run(context) {
      const action = context.args.action?.trim().toLowerCase();

      if (action === undefined) {
        return executeWalletCommand(
          {
            network: context.options.network,
            agent: context.options.agent,
          },
          deps
        ) as Promise<z.infer<typeof walletOutput>>;
      }

      if (action === "status") {
        return executeWalletStatusCommand(
          {
            agent: context.options.agent,
          },
          deps
        ) as Promise<z.infer<typeof walletOutput>>;
      }

      if (action === "init") {
        return executeWalletInitCommand(
          {
            agent: context.options.agent,
            mode: context.options.mode,
            privateKeyStdin: context.options.privateKeyStdin,
            privateKeyFile: context.options.privateKeyFile,
            noPrompt: context.options.prompt === false,
          },
          deps
        ) as Promise<z.infer<typeof walletOutput>>;
      }

      throw new Error(
        "Usage:\n  cli wallet [status] [--network <network>] [--agent <key>]\n  cli wallet init [--agent <key>] [--mode hosted|local-generate|local-key] [--private-key-stdin|--private-key-file <path>] [--no-prompt]"
      );
    },
  });
}
