import { Cli, z } from "incur";
import { executeBudgetInspectCommand } from "../../commands/budget.js";
import {
  executeBudgetActivateCommand,
  executeBudgetFinalizeRemovedCommand,
  executeBudgetPruneCommand,
  executeBudgetRetryResolutionCommand,
  executeBudgetSyncCommand,
} from "../../commands/protocol-budget-maintenance/index.js";
import { participantProtocolWriteOutputSchema } from "./protocol-participant.command-shared.js";
import type { CliDeps } from "../../types.js";
import {
  commandMetadata,
  NETWORK_READ_SCHEMA_METADATA,
  NETWORK_WRITE_SCHEMA_METADATA,
  type RegisteredCommandMetadata,
} from "./command-wrapper-shared.js";

export function registerBudgetCommand(root: Cli.Cli, deps: CliDeps): RegisteredCommandMetadata[] {
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
    description: "Budget protocol inspection and maintenance actions",
  })
    .command("inspect", {
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
    })
    .command("activate", {
      description: "Activate a registered budget whose stack deployment is pending",
      options: z.object({
        controller: z.string().optional().describe("Budget controller / BudgetTCR address"),
        itemId: z.string().optional().describe("Budget item ID bytes32"),
        network: z.string().optional().describe("Execution network"),
        agent: z.string().optional().describe("Agent key"),
        idempotencyKey: z.string().optional().describe("Idempotency key"),
        dryRun: z.boolean().optional().describe("Print the execution plan without sending"),
      }),
      output: participantProtocolWriteOutputSchema,
      run(context) {
        return executeBudgetActivateCommand(context.options, deps);
      },
    })
    .command("finalize-removed", {
      description: "Finalize a removed budget after removal handling becomes available",
      options: z.object({
        controller: z.string().optional().describe("Budget controller / BudgetTCR address"),
        itemId: z.string().optional().describe("Budget item ID bytes32"),
        network: z.string().optional().describe("Execution network"),
        agent: z.string().optional().describe("Agent key"),
        idempotencyKey: z.string().optional().describe("Idempotency key"),
        dryRun: z.boolean().optional().describe("Print the execution plan without sending"),
      }),
      output: participantProtocolWriteOutputSchema,
      run(context) {
        return executeBudgetFinalizeRemovedCommand(context.options, deps);
      },
    })
    .command("retry-resolution", {
      description: "Retry terminal resolution for a removed budget",
      options: z.object({
        controller: z.string().optional().describe("Budget controller / BudgetTCR address"),
        itemId: z.string().optional().describe("Budget item ID bytes32"),
        network: z.string().optional().describe("Execution network"),
        agent: z.string().optional().describe("Agent key"),
        idempotencyKey: z.string().optional().describe("Idempotency key"),
        dryRun: z.boolean().optional().describe("Print the execution plan without sending"),
      }),
      output: participantProtocolWriteOutputSchema,
      run(context) {
        return executeBudgetRetryResolutionCommand(context.options, deps);
      },
    })
    .command("prune", {
      description: "Prune a terminal budget recipient from its parent goal flow",
      options: z.object({
        controller: z.string().optional().describe("Budget controller / BudgetTCR address"),
        budgetTreasury: z.string().optional().describe("Budget treasury address"),
        network: z.string().optional().describe("Execution network"),
        agent: z.string().optional().describe("Agent key"),
        idempotencyKey: z.string().optional().describe("Idempotency key"),
        dryRun: z.boolean().optional().describe("Print the execution plan without sending"),
      }),
      output: participantProtocolWriteOutputSchema,
      run(context) {
        return executeBudgetPruneCommand(context.options, deps);
      },
    })
    .command("sync", {
      description: "Batch-sync active budget treasuries for one or more budget item IDs",
      options: z.object({
        controller: z.string().optional().describe("Budget controller / BudgetTCR address"),
        itemId: z.array(z.string()).optional().describe("Budget item ID bytes32"),
        network: z.string().optional().describe("Execution network"),
        agent: z.string().optional().describe("Agent key"),
        idempotencyKey: z.string().optional().describe("Idempotency key"),
        dryRun: z.boolean().optional().describe("Print the execution plan without sending"),
      }),
      output: participantProtocolWriteOutputSchema,
      run(context) {
        return executeBudgetSyncCommand(context.options, deps);
      },
    });

  root.command(budget);

  return [
    commandMetadata("budget inspect", NETWORK_READ_SCHEMA_METADATA),
    commandMetadata("budget activate", NETWORK_WRITE_SCHEMA_METADATA),
    commandMetadata("budget finalize-removed", NETWORK_WRITE_SCHEMA_METADATA),
    commandMetadata("budget retry-resolution", NETWORK_WRITE_SCHEMA_METADATA),
    commandMetadata("budget prune", NETWORK_WRITE_SCHEMA_METADATA),
    commandMetadata("budget sync", NETWORK_WRITE_SCHEMA_METADATA),
  ];
}
