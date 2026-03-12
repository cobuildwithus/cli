import { Cli, z } from "incur";
import {
  executeFlowClearStaleAllocationCommand,
  executeFlowSyncAllocationCommand,
  executeFlowSyncAllocationForAccountCommand,
} from "../../commands/protocol-participant-flow.js";
import { forwardOptionsToExecutor } from "./command-wrapper-shared.js";
import {
  participantExecutionOptionShape,
  participantProtocolWriteOutputSchema,
} from "./protocol-participant.command-shared.js";
import type { CliDeps } from "../../types.js";
import {
  commandMetadata,
  NETWORK_WRITE_SCHEMA_METADATA,
  type RegisteredCommandMetadata,
} from "./command-wrapper-shared.js";

export function registerFlowCommand(root: Cli.Cli, deps: CliDeps): RegisteredCommandMetadata[] {
  const allocationKeyOptions = z.object({
    flow: z.string().describe("Flow address"),
    allocationKey: z.string().describe("Allocation key"),
    ...participantExecutionOptionShape,
  });

  const accountOptions = z.object({
    flow: z.string().describe("Flow address"),
    account: z.string().describe("Account address"),
    ...participantExecutionOptionShape,
  });
  const runFlowSyncAllocation = forwardOptionsToExecutor(deps, executeFlowSyncAllocationCommand);
  const runFlowSyncAllocationForAccount = forwardOptionsToExecutor(
    deps,
    executeFlowSyncAllocationForAccountCommand
  );
  const runFlowClearStaleAllocation = forwardOptionsToExecutor(
    deps,
    executeFlowClearStaleAllocationCommand
  );

  const flow = Cli.create("flow", {
    description: "Flow allocation maintenance participant actions",
  })
    .command("sync-allocation", {
      description: "Permissionlessly resync a stored flow allocation by allocation key",
      options: allocationKeyOptions,
      output: participantProtocolWriteOutputSchema,
      run: runFlowSyncAllocation,
    })
    .command("sync-allocation-for-account", {
      description: "Permissionlessly resync the default allocation derived for an account",
      options: accountOptions,
      output: participantProtocolWriteOutputSchema,
      run: runFlowSyncAllocationForAccount,
    })
    .command("clear-stale-allocation", {
      description: "Clear stale flow allocation units by allocation key",
      options: allocationKeyOptions,
      output: participantProtocolWriteOutputSchema,
      run: runFlowClearStaleAllocation,
    });

  root.command(flow);

  return [
    commandMetadata("flow sync-allocation", NETWORK_WRITE_SCHEMA_METADATA),
    commandMetadata("flow sync-allocation-for-account", NETWORK_WRITE_SCHEMA_METADATA),
    commandMetadata("flow clear-stale-allocation", NETWORK_WRITE_SCHEMA_METADATA),
  ];
}
