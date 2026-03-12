import { Cli, z } from "incur";
import { executeCommunityAddToBalanceCommand } from "../../commands/community-add-to-balance.js";
import { executeCommunityPayCommand } from "../../commands/community-pay.js";
import { participantProtocolWriteOutputSchema } from "./protocol-participant.command-shared.js";
import type { CliDeps } from "../../types.js";
import {
  commandMetadata,
  NETWORK_WRITE_SCHEMA_METADATA,
  type RegisteredCommandMetadata,
} from "./command-wrapper-shared.js";

export function registerCommunityCommand(root: Cli.Cli, deps: CliDeps): RegisteredCommandMetadata[] {
  const communityJsonInputOptions = z.object({
    inputJson: z.string().optional().describe("Inline community terminal JSON payload"),
    inputFile: z.string().optional().describe("Path to community terminal JSON payload"),
    inputStdin: z.boolean().optional().describe("Read community terminal JSON payload from stdin"),
    dryRun: z.boolean().optional().describe("Print the execution plan without sending"),
  });

  const community = Cli.create("community", {
    description: "Community terminal funding operations",
  })
    .command("pay", {
      description: "Pay a community through CobuildCommunityTerminal",
      options: communityJsonInputOptions,
      output: participantProtocolWriteOutputSchema,
      run(context) {
        return executeCommunityPayCommand(context.options, deps);
      },
    })
    .command("add-to-balance", {
      description: "Add funds to a community through CobuildCommunityTerminal",
      options: communityJsonInputOptions,
      output: participantProtocolWriteOutputSchema,
      run(context) {
        return executeCommunityAddToBalanceCommand(context.options, deps);
      },
    });

  root.command(community);

  return [
    commandMetadata("community pay", NETWORK_WRITE_SCHEMA_METADATA),
    commandMetadata("community add-to-balance", NETWORK_WRITE_SCHEMA_METADATA),
  ];
}
