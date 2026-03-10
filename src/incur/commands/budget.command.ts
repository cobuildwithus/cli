import { Cli, z } from "incur";
import { executeBudgetInspectCommand } from "../../commands/budget.js";
import type { CliDeps } from "../../types.js";

export function registerBudgetCommand(root: Cli.Cli, deps: CliDeps): void {
  const budgetInspectOutput = z
    .object({
      budget: z.unknown(),
      ok: z.boolean().optional(),
      untrusted: z.literal(true),
      source: z.literal("remote_tool"),
      warnings: z.array(z.string()),
    })
    .passthrough();

  const budget = Cli.create("budget", {
    description: "Budget protocol inspection",
  }).command("inspect", {
    description: "Inspect indexed budget state through canonical tool execution",
    args: z.object({
      identifier: z.string().min(1),
    }),
    output: budgetInspectOutput,
    run(context) {
      return executeBudgetInspectCommand(
        {
          identifier: context.args.identifier,
        },
        deps
      );
    },
  });

  root.command(budget);
}
