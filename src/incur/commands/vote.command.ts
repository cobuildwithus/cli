import { Cli, z } from "incur";
import { executeVoteStatusCommand } from "../../commands/vote.js";
import {
  executeVoteCommitCommand,
  executeVoteCommitForCommand,
  executeVoteExecuteRulingCommand,
  executeVoteInvalidRoundRewardsCommand,
  executeVoteRevealCommand,
  executeVoteRewardsCommand,
} from "../../commands/protocol-participant-governance.js";
import { participantProtocolWriteOutputSchema } from "./protocol-participant.command-shared.js";
import type { CliDeps } from "../../types.js";
import {
  commandMetadata,
  NETWORK_READ_SCHEMA_METADATA,
  NETWORK_WRITE_SCHEMA_METADATA,
  type RegisteredCommandMetadata,
} from "./command-wrapper-shared.js";

export function registerVoteCommand(root: Cli.Cli, deps: CliDeps): RegisteredCommandMetadata[] {
  const voteStatusOutput = z
    .object({
      dispute: z.unknown(),
      ok: z.boolean().optional(),
      untrusted: z.literal(true),
      source: z.literal("remote_tool"),
      warnings: z.array(z.string()),
    })
    .passthrough();

  const vote = Cli.create("vote", {
    description: "Arbitrator vote inspection and participant actions",
  })
    .command("status", {
      description: "Inspect indexed vote/dispute state through canonical tool execution",
      args: z.object({
        identifier: z.string().min(1),
      }),
      options: z.object({
        juror: z.string().optional().describe("Optional juror address"),
      }),
      output: voteStatusOutput,
      run(context) {
        return executeVoteStatusCommand(
          {
            identifier: context.args.identifier,
            juror: context.options.juror,
          },
          deps
        );
      },
    })
    .command("commit", {
      description: "Commit a vote hash for the current arbitrator round",
      options: z.object({
        arbitrator: z.string().optional().describe("Arbitrator address"),
        disputeId: z.string().optional().describe("Dispute ID"),
        commitHash: z.string().optional().describe("Precomputed commit hash"),
        round: z.string().optional().describe("Round index"),
        voter: z.string().optional().describe("Voter address"),
        choice: z.string().optional().describe("Juror choice"),
        reason: z.string().optional().describe("Optional reason string"),
        salt: z.string().optional().describe("Reveal salt bytes32"),
        chainId: z.string().optional().describe("Override chain ID for hash derivation"),
        network: z.string().optional().describe("Execution network"),
        agent: z.string().optional().describe("Agent key"),
        idempotencyKey: z.string().optional().describe("Idempotency key"),
        dryRun: z.boolean().optional().describe("Print the execution plan without sending"),
      }),
      output: participantProtocolWriteOutputSchema,
      run(context) {
        return executeVoteCommitCommand(
          {
            arbitrator: context.options.arbitrator,
            disputeId: context.options.disputeId,
            commitHash: context.options.commitHash,
            round: context.options.round,
            voter: context.options.voter,
            choice: context.options.choice,
            reason: context.options.reason,
            salt: context.options.salt,
            chainId: context.options.chainId,
            network: context.options.network,
            agent: context.options.agent,
            idempotencyKey: context.options.idempotencyKey,
            dryRun: context.options.dryRun,
          },
          deps
        );
      },
    })
    .command("commit-for", {
      description: "Commit a delegated vote hash for a specific juror",
      options: z.object({
        arbitrator: z.string().optional().describe("Arbitrator address"),
        disputeId: z.string().optional().describe("Dispute ID"),
        voter: z.string().optional().describe("Voter address"),
        commitHash: z.string().optional().describe("Precomputed commit hash"),
        round: z.string().optional().describe("Round index"),
        choice: z.string().optional().describe("Juror choice"),
        reason: z.string().optional().describe("Optional reason string"),
        salt: z.string().optional().describe("Reveal salt bytes32"),
        chainId: z.string().optional().describe("Override chain ID for hash derivation"),
        network: z.string().optional().describe("Execution network"),
        agent: z.string().optional().describe("Agent key"),
        idempotencyKey: z.string().optional().describe("Idempotency key"),
        dryRun: z.boolean().optional().describe("Print the execution plan without sending"),
      }),
      output: participantProtocolWriteOutputSchema,
      run(context) {
        return executeVoteCommitForCommand(
          {
            arbitrator: context.options.arbitrator,
            disputeId: context.options.disputeId,
            voter: context.options.voter,
            commitHash: context.options.commitHash,
            round: context.options.round,
            choice: context.options.choice,
            reason: context.options.reason,
            salt: context.options.salt,
            chainId: context.options.chainId,
            network: context.options.network,
            agent: context.options.agent,
            idempotencyKey: context.options.idempotencyKey,
            dryRun: context.options.dryRun,
          },
          deps
        );
      },
    })
    .command("reveal", {
      description: "Reveal a previously committed arbitrator vote",
      options: z.object({
        arbitrator: z.string().optional().describe("Arbitrator address"),
        disputeId: z.string().optional().describe("Dispute ID"),
        voter: z.string().optional().describe("Voter address"),
        choice: z.string().optional().describe("Juror choice"),
        reason: z.string().optional().describe("Optional reason string"),
        salt: z.string().optional().describe("Reveal salt bytes32"),
        network: z.string().optional().describe("Execution network"),
        agent: z.string().optional().describe("Agent key"),
        idempotencyKey: z.string().optional().describe("Idempotency key"),
        dryRun: z.boolean().optional().describe("Print the execution plan without sending"),
      }),
      output: participantProtocolWriteOutputSchema,
      run(context) {
        return executeVoteRevealCommand(
          {
            arbitrator: context.options.arbitrator,
            disputeId: context.options.disputeId,
            voter: context.options.voter,
            choice: context.options.choice,
            reason: context.options.reason,
            salt: context.options.salt,
            network: context.options.network,
            agent: context.options.agent,
            idempotencyKey: context.options.idempotencyKey,
            dryRun: context.options.dryRun,
          },
          deps
        );
      },
    })
    .command("rewards", {
      description: "Withdraw voter rewards for a resolved arbitrator round",
      options: z.object({
        arbitrator: z.string().optional().describe("Arbitrator address"),
        disputeId: z.string().optional().describe("Dispute ID"),
        round: z.string().optional().describe("Round index"),
        voter: z.string().optional().describe("Voter address"),
        network: z.string().optional().describe("Execution network"),
        agent: z.string().optional().describe("Agent key"),
        idempotencyKey: z.string().optional().describe("Idempotency key"),
        dryRun: z.boolean().optional().describe("Print the execution plan without sending"),
      }),
      output: participantProtocolWriteOutputSchema,
      run(context) {
        return executeVoteRewardsCommand(
          {
            arbitrator: context.options.arbitrator,
            disputeId: context.options.disputeId,
            round: context.options.round,
            voter: context.options.voter,
            network: context.options.network,
            agent: context.options.agent,
            idempotencyKey: context.options.idempotencyKey,
            dryRun: context.options.dryRun,
          },
          deps
        );
      },
    })
    .command("invalid-round-rewards", {
      description: "Withdraw invalid-round rewards when no votes were cast",
      options: z.object({
        arbitrator: z.string().optional().describe("Arbitrator address"),
        disputeId: z.string().optional().describe("Dispute ID"),
        round: z.string().optional().describe("Round index"),
        network: z.string().optional().describe("Execution network"),
        agent: z.string().optional().describe("Agent key"),
        idempotencyKey: z.string().optional().describe("Idempotency key"),
        dryRun: z.boolean().optional().describe("Print the execution plan without sending"),
      }),
      output: participantProtocolWriteOutputSchema,
      run(context) {
        return executeVoteInvalidRoundRewardsCommand(
          {
            arbitrator: context.options.arbitrator,
            disputeId: context.options.disputeId,
            round: context.options.round,
            network: context.options.network,
            agent: context.options.agent,
            idempotencyKey: context.options.idempotencyKey,
            dryRun: context.options.dryRun,
          },
          deps
        );
      },
    })
    .command("execute-ruling", {
      description: "Execute a solved arbitrator ruling",
      options: z.object({
        arbitrator: z.string().optional().describe("Arbitrator address"),
        disputeId: z.string().optional().describe("Dispute ID"),
        network: z.string().optional().describe("Execution network"),
        agent: z.string().optional().describe("Agent key"),
        idempotencyKey: z.string().optional().describe("Idempotency key"),
        dryRun: z.boolean().optional().describe("Print the execution plan without sending"),
      }),
      output: participantProtocolWriteOutputSchema,
      run(context) {
        return executeVoteExecuteRulingCommand(
          {
            arbitrator: context.options.arbitrator,
            disputeId: context.options.disputeId,
            network: context.options.network,
            agent: context.options.agent,
            idempotencyKey: context.options.idempotencyKey,
            dryRun: context.options.dryRun,
          },
          deps
        );
      },
    });

  root.command(vote);

  return [
    commandMetadata("vote status", NETWORK_READ_SCHEMA_METADATA),
    commandMetadata("vote commit", NETWORK_WRITE_SCHEMA_METADATA),
    commandMetadata("vote commit-for", NETWORK_WRITE_SCHEMA_METADATA),
    commandMetadata("vote reveal", NETWORK_WRITE_SCHEMA_METADATA),
    commandMetadata("vote rewards", NETWORK_WRITE_SCHEMA_METADATA),
    commandMetadata("vote invalid-round-rewards", NETWORK_WRITE_SCHEMA_METADATA),
    commandMetadata("vote execute-ruling", NETWORK_WRITE_SCHEMA_METADATA),
  ];
}
