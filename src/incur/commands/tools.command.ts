import { Cli, z } from "incur";
import {
  executeToolsCastPreviewCommand,
  executeToolsGetCastCommand,
  executeToolsGetWalletBalancesCommand,
  executeToolsGetUserCommand,
  executeToolsTreasuryStatsCommand,
} from "../../commands/tools.js";
import type { CliDeps } from "../../types.js";

export function registerToolsCommand(
  root: Cli.Cli,
  deps: CliDeps,
  decodeEscapedPositional: (value: string) => string
): void {
  const toolNameArgs = z.object({
    value: z.string().min(1),
  });
  const getUserOutput = z
    .object({
      result: z.unknown(),
      ok: z.boolean().optional(),
      untrusted: z.literal(true),
      source: z.literal("remote_tool"),
      warnings: z.array(z.string()),
    })
    .passthrough();
  const getCastOutput = z
    .object({
      cast: z.unknown(),
      ok: z.boolean().optional(),
      untrusted: z.literal(true),
      source: z.literal("remote_tool"),
      warnings: z.array(z.string()),
    })
    .passthrough();
  const castPreviewOutput = z
    .object({
      cast: z.unknown(),
      ok: z.boolean().optional(),
      untrusted: z.literal(true),
      source: z.literal("remote_tool"),
      warnings: z.array(z.string()),
    })
    .passthrough();
  const treasuryStatsOutput = z
    .object({
      data: z.unknown(),
      ok: z.boolean().optional(),
      untrusted: z.literal(true),
      source: z.literal("remote_tool"),
      warnings: z.array(z.string()),
    })
    .passthrough();
  const walletBalancesOutput = z
    .object({
      data: z.unknown(),
      ok: z.boolean().optional(),
      untrusted: z.literal(true),
      source: z.literal("remote_tool"),
      warnings: z.array(z.string()),
    })
    .passthrough();

  const tools = Cli.create("tools", {
    description: "Execute canonical tool endpoints",
  })
    .command("get-user", {
      description: "Lookup user profile by name",
      args: toolNameArgs,
      output: getUserOutput,
      run(context) {
        return executeToolsGetUserCommand(
          {
            fname: decodeEscapedPositional(context.args.value),
          },
          deps
        );
      },
    })
    .command("get-cast", {
      description: "Lookup cast by hash or URL",
      args: toolNameArgs,
      options: z.object({
        type: z.enum(["hash", "url"]).optional(),
      }),
      output: getCastOutput,
      run(context) {
        return executeToolsGetCastCommand(
          {
            identifier: decodeEscapedPositional(context.args.value),
            type: context.options.type,
          },
          deps
        );
      },
    })
    .command("cast-preview", {
      description: "Generate cast preview payload",
      options: z.object({
        text: z.string().optional(),
        embed: z.array(z.string()).optional(),
        parent: z.string().optional(),
      }),
      output: castPreviewOutput,
      run(context) {
        return executeToolsCastPreviewCommand(
          {
            text: context.options.text,
            embed: context.options.embed,
            parent: context.options.parent,
          },
          deps
        );
      },
    })
    .command("get-treasury-stats", {
      description: "Fetch treasury stats snapshot",
      args: z.object({
        extra: z.never().optional(),
      }),
      output: treasuryStatsOutput,
      run() {
        return executeToolsTreasuryStatsCommand(deps);
      },
    })
    .command("get-wallet-balances", {
      description: "Fetch wallet ETH and USDC balances",
      args: z.object({
        extra: z.never().optional(),
      }),
      options: z.object({
        agent: z.string().optional(),
        network: z.string().optional(),
      }),
      output: walletBalancesOutput,
      run(context) {
        return executeToolsGetWalletBalancesCommand(
          {
            agent: context.options.agent,
            network: context.options.network,
          },
          deps
        );
      },
    });

  root.command(tools);
}
