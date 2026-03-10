import { Cli, z } from "incur";
import { executePremiumStatusCommand } from "../../commands/premium.js";
import {
  executePremiumCheckpointCommand,
  executePremiumClaimCommand,
} from "../../commands/protocol-participant-stake-premium.js";
import { participantProtocolWriteOutputSchema } from "./protocol-participant.command-shared.js";
import type { CliDeps } from "../../types.js";

export function registerPremiumCommand(root: Cli.Cli, deps: CliDeps): void {
  const premiumStatusOutput = z
    .object({
      premiumEscrow: z.unknown(),
      ok: z.boolean().optional(),
      untrusted: z.literal(true),
      source: z.literal("remote_tool"),
      warnings: z.array(z.string()),
    })
    .passthrough();

  const premium = Cli.create("premium", {
    description: "Premium escrow inspection and participant actions",
  })
    .command("status", {
      description: "Inspect indexed premium escrow state through canonical tool execution",
      args: z.object({
        identifier: z.string().min(1),
      }),
      options: z.object({
        account: z.string().optional().describe("Optional account address"),
      }),
      output: premiumStatusOutput,
      run(context) {
        return executePremiumStatusCommand(
          {
            identifier: context.args.identifier,
            account: context.options.account,
          },
          deps
        );
      },
    })
    .command("checkpoint", {
      description: "Checkpoint premium state for an account",
      options: z.object({
        escrow: z.string().optional().describe("Premium escrow address"),
        account: z.string().optional().describe("Account address"),
        network: z.string().optional().describe("Execution network"),
        agent: z.string().optional().describe("Agent key"),
        idempotencyKey: z.string().optional().describe("Idempotency key"),
        dryRun: z.boolean().optional().describe("Print the execution plan without sending"),
      }),
      output: participantProtocolWriteOutputSchema,
      run(context) {
        return executePremiumCheckpointCommand(context.options, deps);
      },
    })
    .command("claim", {
      description: "Claim premium to a recipient address",
      options: z.object({
        escrow: z.string().optional().describe("Premium escrow address"),
        recipient: z.string().optional().describe("Recipient address"),
        network: z.string().optional().describe("Execution network"),
        agent: z.string().optional().describe("Agent key"),
        idempotencyKey: z.string().optional().describe("Idempotency key"),
        dryRun: z.boolean().optional().describe("Print the execution plan without sending"),
      }),
      output: participantProtocolWriteOutputSchema,
      run(context) {
        return executePremiumClaimCommand(context.options, deps);
      },
    });

  root.command(premium);
}
