import { Cli, z } from "incur";
import { executeStakeStatusCommand } from "../../commands/stake.js";
import type { CliDeps } from "../../types.js";

export function registerStakeCommand(root: Cli.Cli, deps: CliDeps): void {
  const stakeStatusOutput = z
    .object({
      stakePosition: z.unknown(),
      ok: z.boolean().optional(),
      untrusted: z.literal(true),
      source: z.literal("remote_tool"),
      warnings: z.array(z.string()),
    })
    .passthrough();

  const stake = Cli.create("stake", {
    description: "Stake protocol inspection",
  }).command("status", {
    description: "Inspect indexed stake position state through canonical tool execution",
    args: z.object({
      identifier: z.string().min(1),
      account: z.string().min(1),
    }),
    output: stakeStatusOutput,
    run(context) {
      return executeStakeStatusCommand(
        {
          identifier: context.args.identifier,
          account: context.args.account,
        },
        deps
      );
    },
  });

  root.command(stake);
}
