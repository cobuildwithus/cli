import { Cli, z } from "incur";
import { executeTcrInspectCommand } from "../../commands/tcr.js";
import {
  executeTcrChallengeCommand,
  executeTcrEvidenceCommand,
  executeTcrExecuteCommand,
  executeTcrRemoveCommand,
  executeTcrSubmitBudgetCommand,
  executeTcrSubmitMechanismCommand,
  executeTcrSubmitRoundSubmissionCommand,
  executeTcrTimeoutCommand,
  executeTcrWithdrawCommand,
} from "../../commands/protocol-participant-governance.js";
import { participantProtocolWriteOutputSchema } from "./protocol-participant.command-shared.js";
import type { CliDeps } from "../../types.js";
import {
  commandMetadata,
  NETWORK_READ_SCHEMA_METADATA,
  NETWORK_WRITE_SCHEMA_METADATA,
  type RegisteredCommandMetadata,
} from "./command-wrapper-shared.js";

export function registerTcrCommand(root: Cli.Cli, deps: CliDeps): RegisteredCommandMetadata[] {
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
    description: "TCR protocol inspection and participant write actions",
  })
    .command("inspect", {
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
    })
    .command("submit-budget", {
      description: "Submit a budget listing to a Budget TCR using JSON input",
      options: z.object({
        inputJson: z.string().optional().describe("Inline JSON payload"),
        inputFile: z.string().optional().describe("Path to JSON payload"),
        inputStdin: z.boolean().optional().describe("Read JSON payload from stdin"),
        dryRun: z.boolean().optional().describe("Print the execution plan without sending"),
      }),
      output: participantProtocolWriteOutputSchema,
      run(context) {
        return executeTcrSubmitBudgetCommand(
          {
            inputJson: context.options.inputJson,
            inputFile: context.options.inputFile,
            inputStdin: context.options.inputStdin,
            dryRun: context.options.dryRun,
          },
          deps
        );
      },
    })
    .command("submit-mechanism", {
      description: "Submit an allocation mechanism listing to a TCR using JSON input",
      options: z.object({
        inputJson: z.string().optional().describe("Inline JSON payload"),
        inputFile: z.string().optional().describe("Path to JSON payload"),
        inputStdin: z.boolean().optional().describe("Read JSON payload from stdin"),
        dryRun: z.boolean().optional().describe("Print the execution plan without sending"),
      }),
      output: participantProtocolWriteOutputSchema,
      run(context) {
        return executeTcrSubmitMechanismCommand(
          {
            inputJson: context.options.inputJson,
            inputFile: context.options.inputFile,
            inputStdin: context.options.inputStdin,
            dryRun: context.options.dryRun,
          },
          deps
        );
      },
    })
    .command("submit-round-submission", {
      description: "Submit a round submission listing to a TCR using JSON input",
      options: z.object({
        inputJson: z.string().optional().describe("Inline JSON payload"),
        inputFile: z.string().optional().describe("Path to JSON payload"),
        inputStdin: z.boolean().optional().describe("Read JSON payload from stdin"),
        dryRun: z.boolean().optional().describe("Print the execution plan without sending"),
      }),
      output: participantProtocolWriteOutputSchema,
      run(context) {
        return executeTcrSubmitRoundSubmissionCommand(
          {
            inputJson: context.options.inputJson,
            inputFile: context.options.inputFile,
            inputStdin: context.options.inputStdin,
            dryRun: context.options.dryRun,
          },
          deps
        );
      },
    })
    .command("remove", {
      description: "Request removal of an existing TCR item",
      options: z.object({
        registry: z.string().optional().describe("Generalized TCR address"),
        depositToken: z.string().optional().describe("ERC-20 deposit token address"),
        itemId: z.string().optional().describe("Item ID bytes32"),
        evidence: z.string().optional().describe("Optional evidence string"),
        costsJson: z.string().optional().describe("Inline JSON total-cost snapshot"),
        costsFile: z.string().optional().describe("Path to JSON total-cost snapshot"),
        costsStdin: z.boolean().optional().describe("Read JSON total-cost snapshot from stdin"),
        network: z.string().optional().describe("Execution network"),
        agent: z.string().optional().describe("Agent key"),
        idempotencyKey: z.string().optional().describe("Idempotency key"),
        dryRun: z.boolean().optional().describe("Print the execution plan without sending"),
      }),
      output: participantProtocolWriteOutputSchema,
      run(context) {
        return executeTcrRemoveCommand(
          {
            registry: context.options.registry,
            depositToken: context.options.depositToken,
            itemId: context.options.itemId,
            evidence: context.options.evidence,
            costsJson: context.options.costsJson,
            costsFile: context.options.costsFile,
            costsStdin: context.options.costsStdin,
            network: context.options.network,
            agent: context.options.agent,
            idempotencyKey: context.options.idempotencyKey,
            dryRun: context.options.dryRun,
          },
          deps
        );
      },
    })
    .command("challenge", {
      description: "Challenge a pending TCR request",
      options: z.object({
        registry: z.string().optional().describe("Generalized TCR address"),
        depositToken: z.string().optional().describe("ERC-20 deposit token address"),
        itemId: z.string().optional().describe("Item ID bytes32"),
        requestType: z.string().optional().describe("registrationRequested|clearingRequested|2|3"),
        evidence: z.string().optional().describe("Optional evidence string"),
        costsJson: z.string().optional().describe("Inline JSON total-cost snapshot"),
        costsFile: z.string().optional().describe("Path to JSON total-cost snapshot"),
        costsStdin: z.boolean().optional().describe("Read JSON total-cost snapshot from stdin"),
        network: z.string().optional().describe("Execution network"),
        agent: z.string().optional().describe("Agent key"),
        idempotencyKey: z.string().optional().describe("Idempotency key"),
        dryRun: z.boolean().optional().describe("Print the execution plan without sending"),
      }),
      output: participantProtocolWriteOutputSchema,
      run(context) {
        return executeTcrChallengeCommand(
          {
            registry: context.options.registry,
            depositToken: context.options.depositToken,
            itemId: context.options.itemId,
            requestType: context.options.requestType,
            evidence: context.options.evidence,
            costsJson: context.options.costsJson,
            costsFile: context.options.costsFile,
            costsStdin: context.options.costsStdin,
            network: context.options.network,
            agent: context.options.agent,
            idempotencyKey: context.options.idempotencyKey,
            dryRun: context.options.dryRun,
          },
          deps
        );
      },
    })
    .command("execute", {
      description: "Execute an unchallenged TCR request after the challenge window closes",
      options: z.object({
        registry: z.string().optional().describe("Generalized TCR address"),
        itemId: z.string().optional().describe("Item ID bytes32"),
        network: z.string().optional().describe("Execution network"),
        agent: z.string().optional().describe("Agent key"),
        idempotencyKey: z.string().optional().describe("Idempotency key"),
        dryRun: z.boolean().optional().describe("Print the execution plan without sending"),
      }),
      output: participantProtocolWriteOutputSchema,
      run(context) {
        return executeTcrExecuteCommand(
          {
            registry: context.options.registry,
            itemId: context.options.itemId,
            network: context.options.network,
            agent: context.options.agent,
            idempotencyKey: context.options.idempotencyKey,
            dryRun: context.options.dryRun,
          },
          deps
        );
      },
    })
    .command("timeout", {
      description: "Execute the dispute-timeout path for a TCR request",
      options: z.object({
        registry: z.string().optional().describe("Generalized TCR address"),
        itemId: z.string().optional().describe("Item ID bytes32"),
        network: z.string().optional().describe("Execution network"),
        agent: z.string().optional().describe("Agent key"),
        idempotencyKey: z.string().optional().describe("Idempotency key"),
        dryRun: z.boolean().optional().describe("Print the execution plan without sending"),
      }),
      output: participantProtocolWriteOutputSchema,
      run(context) {
        return executeTcrTimeoutCommand(
          {
            registry: context.options.registry,
            itemId: context.options.itemId,
            network: context.options.network,
            agent: context.options.agent,
            idempotencyKey: context.options.idempotencyKey,
            dryRun: context.options.dryRun,
          },
          deps
        );
      },
    })
    .command("evidence", {
      description: "Submit evidence on the current TCR request cycle",
      options: z.object({
        registry: z.string().optional().describe("Generalized TCR address"),
        itemId: z.string().optional().describe("Item ID bytes32"),
        evidence: z.string().optional().describe("Evidence string"),
        network: z.string().optional().describe("Execution network"),
        agent: z.string().optional().describe("Agent key"),
        idempotencyKey: z.string().optional().describe("Idempotency key"),
        dryRun: z.boolean().optional().describe("Print the execution plan without sending"),
      }),
      output: participantProtocolWriteOutputSchema,
      run(context) {
        return executeTcrEvidenceCommand(
          {
            registry: context.options.registry,
            itemId: context.options.itemId,
            evidence: context.options.evidence,
            network: context.options.network,
            agent: context.options.agent,
            idempotencyKey: context.options.idempotencyKey,
            dryRun: context.options.dryRun,
          },
          deps
        );
      },
    })
    .command("withdraw", {
      description: "Withdraw resolved TCR fees and rewards",
      options: z.object({
        registry: z.string().optional().describe("Generalized TCR address"),
        beneficiary: z.string().optional().describe("Beneficiary address"),
        itemId: z.string().optional().describe("Item ID bytes32"),
        requestIndex: z.string().optional().describe("Request index"),
        roundIndex: z.string().optional().describe("Round index"),
        network: z.string().optional().describe("Execution network"),
        agent: z.string().optional().describe("Agent key"),
        idempotencyKey: z.string().optional().describe("Idempotency key"),
        dryRun: z.boolean().optional().describe("Print the execution plan without sending"),
      }),
      output: participantProtocolWriteOutputSchema,
      run(context) {
        return executeTcrWithdrawCommand(
          {
            registry: context.options.registry,
            beneficiary: context.options.beneficiary,
            itemId: context.options.itemId,
            requestIndex: context.options.requestIndex,
            roundIndex: context.options.roundIndex,
            network: context.options.network,
            agent: context.options.agent,
            idempotencyKey: context.options.idempotencyKey,
            dryRun: context.options.dryRun,
          },
          deps
        );
      },
    });

  root.command(tcr);

  return [
    commandMetadata("tcr inspect", NETWORK_READ_SCHEMA_METADATA),
    commandMetadata("tcr submit-budget", NETWORK_WRITE_SCHEMA_METADATA),
    commandMetadata("tcr submit-mechanism", NETWORK_WRITE_SCHEMA_METADATA),
    commandMetadata("tcr submit-round-submission", NETWORK_WRITE_SCHEMA_METADATA),
    commandMetadata("tcr remove", NETWORK_WRITE_SCHEMA_METADATA),
    commandMetadata("tcr challenge", NETWORK_WRITE_SCHEMA_METADATA),
    commandMetadata("tcr execute", NETWORK_WRITE_SCHEMA_METADATA),
    commandMetadata("tcr timeout", NETWORK_WRITE_SCHEMA_METADATA),
    commandMetadata("tcr evidence", NETWORK_WRITE_SCHEMA_METADATA),
    commandMetadata("tcr withdraw", NETWORK_WRITE_SCHEMA_METADATA),
  ];
}
