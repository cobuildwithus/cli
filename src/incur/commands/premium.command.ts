import { Cli, z } from "incur";
import { executePremiumStatusCommand } from "../../commands/premium.js";
import {
  executePremiumCheckpointCommand,
  executePremiumClaimCommand,
} from "../../commands/protocol-participant-stake-premium.js";
import { forwardOptionsToExecutor } from "./command-wrapper-shared.js";
import {
  participantExecutionOptionShape,
  participantProtocolWriteOutputSchema,
} from "./protocol-participant.command-shared.js";
import type { CliDeps } from "../../types.js";
import {
  commandMetadata,
  NETWORK_READ_SCHEMA_METADATA,
  NETWORK_WRITE_SCHEMA_METADATA,
  type RegisteredCommandMetadata,
} from "./command-wrapper-shared.js";

export function registerPremiumCommand(root: Cli.Cli, deps: CliDeps): RegisteredCommandMetadata[] {
  const premiumStatusOutput = z
    .object({
      premiumEscrow: z.unknown(),
      ok: z.boolean().optional(),
      untrusted: z.literal(true),
      source: z.literal("remote_tool"),
      warnings: z.array(z.string()),
    })
    .passthrough();
  const premiumStatusOptions = z.object({
    account: z.string().optional().describe("Optional account address"),
  });
  const premiumCheckpointOptions = z.object({
    escrow: z.string().optional().describe("Premium escrow address"),
    account: z.string().optional().describe("Account address"),
    ...participantExecutionOptionShape,
  });
  const premiumClaimOptions = z.object({
    escrow: z.string().optional().describe("Premium escrow address"),
    recipient: z.string().optional().describe("Recipient address"),
    ...participantExecutionOptionShape,
  });
  const runPremiumCheckpoint = forwardOptionsToExecutor(deps, executePremiumCheckpointCommand);
  const runPremiumClaim = forwardOptionsToExecutor(deps, executePremiumClaimCommand);

  const premium = Cli.create("premium", {
    description: "Premium escrow inspection and participant actions",
  })
    .command("status", {
      description: "Inspect indexed premium escrow state through canonical tool execution",
      args: z.object({
        identifier: z.string().min(1),
      }),
      options: premiumStatusOptions,
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
      options: premiumCheckpointOptions,
      output: participantProtocolWriteOutputSchema,
      run: runPremiumCheckpoint,
    })
    .command("claim", {
      description: "Claim premium to a recipient address",
      options: premiumClaimOptions,
      output: participantProtocolWriteOutputSchema,
      run: runPremiumClaim,
    });

  root.command(premium);

  return [
    commandMetadata("premium status", NETWORK_READ_SCHEMA_METADATA),
    commandMetadata("premium checkpoint", NETWORK_WRITE_SCHEMA_METADATA),
    commandMetadata("premium claim", NETWORK_WRITE_SCHEMA_METADATA),
  ];
}
