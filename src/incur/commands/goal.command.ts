import { Cli, z } from "incur";
import { executeGoalCreateCommand, executeGoalInspectCommand } from "../../commands/goal.js";
import type { CliDeps } from "../../types.js";

export function registerGoalCommand(root: Cli.Cli, deps: CliDeps): void {
  const goalCreateOutput = z
    .object({
      idempotencyKey: z.string(),
    })
    .passthrough();
  const goalInspectOutput = z
    .object({
      goal: z.unknown(),
      ok: z.boolean().optional(),
      untrusted: z.literal(true),
      source: z.literal("remote_tool"),
      warnings: z.array(z.string()),
    })
    .passthrough();

  const goal = Cli.create("goal", {
    description: "Goal protocol operations",
  })
    .command("inspect", {
      description: "Inspect indexed goal state through canonical tool execution",
      args: z.object({
        identifier: z.string().min(1),
      }),
      output: goalInspectOutput,
      run(context) {
        return executeGoalInspectCommand(
          {
            identifier: context.args.identifier,
          },
          deps
        );
      },
    })
    .command("create", {
      description: "Create a goal through GoalFactory.deployGoal",
      options: z.object({
        factory: z.string().optional(),
        paramsFile: z.string().optional(),
        paramsJson: z.string().optional(),
        paramsStdin: z.boolean().optional(),
        network: z.string().optional(),
        agent: z.string().optional(),
        idempotencyKey: z.string().optional(),
        dryRun: z.boolean().optional(),
      }),
      output: goalCreateOutput,
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
            dryRun: context.options.dryRun,
          },
          deps
        );
      },
    });

  root.command(goal);
}
