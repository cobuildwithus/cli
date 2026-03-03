import { Cli, z } from "incur";
import { executeGoalCreateCommand } from "../../commands/goal.js";
import type { CliDeps } from "../../types.js";

export function registerGoalCommand(root: Cli.Cli, deps: CliDeps): void {
  const goalOutput = z
    .object({
      idempotencyKey: z.string(),
    })
    .passthrough();

  const goal = Cli.create("goal", {
    description: "Goal onchain operations",
  }).command("create", {
    description: "Create a goal through GoalFactory.deployGoal",
    options: z.object({
      factory: z.string().optional(),
      paramsFile: z.string().optional(),
      paramsJson: z.string().optional(),
      paramsStdin: z.boolean().optional(),
      network: z.string().optional(),
      agent: z.string().optional(),
      idempotencyKey: z.string().optional(),
    }),
    output: goalOutput,
    run(context) {
      return executeGoalCreateCommand(
        {
          factory: context.options.factory,
          paramsFile: context.options.paramsFile,
          paramsJson: context.options.paramsJson,
          paramsStdin: context.options.paramsStdin,
          network: context.options.network,
          agent: context.options.agent,
          idempotencyKey: context.options.idempotencyKey,
        },
        deps
      );
    },
  });

  root.command(goal);
}
