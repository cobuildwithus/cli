import { Cli, z } from "incur";
import { executeTcrInspectCommand } from "../../commands/tcr.js";
import type { CliDeps } from "../../types.js";

export function registerTcrCommand(root: Cli.Cli, deps: CliDeps): void {
  const tcrInspectOutput = z
    .object({
      tcrRequest: z.unknown(),
      ok: z.boolean().optional(),
      untrusted: z.literal(true),
      source: z.literal("remote_tool"),
      warnings: z.array(z.string()),
    })
    .passthrough();

  const tcr = Cli.create("tcr", {
    description: "TCR protocol inspection",
  }).command("inspect", {
    description: "Inspect indexed TCR request state through canonical tool execution",
    args: z.object({
      identifier: z.string().min(1),
    }),
    output: tcrInspectOutput,
    run(context) {
      return executeTcrInspectCommand(
        {
          identifier: context.args.identifier,
        },
        deps
      );
    },
  });

  root.command(tcr);
}
