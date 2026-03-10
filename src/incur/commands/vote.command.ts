import { Cli, z } from "incur";
import { executeVoteStatusCommand } from "../../commands/vote.js";
import type { CliDeps } from "../../types.js";

export function registerVoteCommand(root: Cli.Cli, deps: CliDeps): void {
  const voteStatusOutput = z
    .object({
      dispute: z.unknown(),
      ok: z.boolean().optional(),
      untrusted: z.literal(true),
      source: z.literal("remote_tool"),
      warnings: z.array(z.string()),
    })
    .passthrough();

  const vote = Cli.create("vote", {
    description: "Vote and dispute inspection",
  }).command("status", {
    description: "Inspect indexed dispute state through canonical tool execution",
    args: z.object({
      identifier: z.string().min(1),
    }),
    options: z.object({
      juror: z
        .string()
        .refine((value) => value.trim().length > 0, {
          message: "--juror cannot be empty.",
        })
        .optional(),
    }),
    output: voteStatusOutput,
    run(context) {
      return executeVoteStatusCommand(
        {
          identifier: context.args.identifier,
          juror: context.options.juror,
        },
        deps
      );
    },
  });

  root.command(vote);
}
