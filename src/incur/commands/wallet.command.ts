import { Cli, z } from "incur";
import {
  executeWalletCommand,
  executeWalletPayerInitCommand,
  executeWalletPayerStatusCommand,
} from "../../commands/wallet.js";
import type { CliDeps } from "../../types.js";

export function registerWalletCommand(root: Cli.Cli, deps: CliDeps): void {
  const walletPayerOutput = z.object({
    mode: z.enum(["hosted", "local"]),
    payerAddress: z.string().nullable(),
    network: z.string(),
    token: z.string(),
    costPerPaidCallMicroUsdc: z.string(),
  });
  const walletOutput = z
    .object({
      ok: z.boolean().optional(),
      address: z.string().optional(),
      agentKey: z.string().optional(),
      payer: walletPayerOutput.optional(),
    })
    .passthrough();

  root.command("wallet", {
    description: "Fetch wallet details and manage payer configuration",
    args: z.object({
      namespace: z.string().optional(),
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
      const namespace = context.args.namespace?.trim().toLowerCase();
      const action = context.args.action?.trim().toLowerCase();

      if (namespace === undefined && action === undefined) {
        return executeWalletCommand(
          {
            network: context.options.network,
            agent: context.options.agent,
          },
          deps
        ) as Promise<z.infer<typeof walletOutput>>;
      }

      if (namespace === "payer" && action === "init") {
        return executeWalletPayerInitCommand(
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

      if (namespace === "payer" && action === "status") {
        return executeWalletPayerStatusCommand(
          {
            agent: context.options.agent,
          },
          deps
        ) as Promise<z.infer<typeof walletOutput>>;
      }

      throw new Error(
        "Usage:\n  cli wallet [--network <network>] [--agent <key>]\n  cli wallet payer init [--agent <key>] [--mode hosted|local-generate|local-key] [--private-key-stdin|--private-key-file <path>] [--no-prompt]\n  cli wallet payer status [--agent <key>]"
      );
    },
  });
}
