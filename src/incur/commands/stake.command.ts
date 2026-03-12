import { Cli, z } from "incur";
import { executeStakeStatusCommand } from "../../commands/stake.js";
import {
  executeStakeDepositCobuildCommand,
  executeStakeDepositGoalCommand,
  executeStakeFinalizeJurorExitCommand,
  executeStakeOptInJurorCommand,
  executeStakePrepareUnderwriterWithdrawalCommand,
  executeStakeRequestJurorExitCommand,
  executeStakeSetJurorDelegateCommand,
  executeStakeWithdrawCobuildCommand,
  executeStakeWithdrawGoalCommand,
} from "../../commands/protocol-participant-stake-premium.js";
import { participantProtocolWriteOutputSchema } from "./protocol-participant.command-shared.js";
import type { CliDeps } from "../../types.js";
import {
  commandMetadata,
  NETWORK_READ_SCHEMA_METADATA,
  NETWORK_WRITE_SCHEMA_METADATA,
  type RegisteredCommandMetadata,
} from "./command-wrapper-shared.js";

export function registerStakeCommand(root: Cli.Cli, deps: CliDeps): RegisteredCommandMetadata[] {
  const stakeStatusOutput = z
    .object({
      stakePosition: z.unknown(),
      ok: z.boolean().optional(),
      untrusted: z.literal(true),
      source: z.literal("remote_tool"),
      warnings: z.array(z.string()),
    })
    .passthrough();

  const participantExecutionOptionFields = {
    network: z.string().optional().describe("Execution network"),
    agent: z.string().optional().describe("Agent key"),
    idempotencyKey: z.string().optional().describe("Idempotency key"),
    dryRun: z.boolean().optional().describe("Print the execution plan without sending"),
  };

  const stakeVaultOptionField = {
    vault: z.string().optional().describe("Stake vault address"),
  };

  const approvalOptionFields = {
    approvalMode: z
      .enum(["auto", "force", "skip"])
      .optional()
      .describe("Approval behavior"),
    currentAllowance: z.string().optional().describe("Current ERC-20 allowance"),
    approvalAmount: z.string().optional().describe("Override approval amount"),
  };

  const depositOptions = z.object({
    ...stakeVaultOptionField,
    token: z.string().optional().describe("Token address"),
    amount: z.string().optional().describe("Atomic token amount"),
    ...approvalOptionFields,
    ...participantExecutionOptionFields,
  });

  const withdrawOptions = z.object({
    ...stakeVaultOptionField,
    amount: z.string().optional().describe("Atomic token amount"),
    recipient: z.string().optional().describe("Recipient address"),
    ...participantExecutionOptionFields,
  });

  const optInJurorOptions = z.object({
    ...stakeVaultOptionField,
    token: z.string().optional().describe("Goal token address"),
    goalAmount: z.string().optional().describe("Atomic goal token amount"),
    delegate: z.string().optional().describe("Juror delegate address"),
    ...approvalOptionFields,
    ...participantExecutionOptionFields,
  });

  const jurorGoalAmountOptions = z.object({
    ...stakeVaultOptionField,
    goalAmount: z.string().optional().describe("Atomic goal token amount"),
    ...participantExecutionOptionFields,
  });

  const jurorVaultOptions = z.object({
    ...stakeVaultOptionField,
    ...participantExecutionOptionFields,
  });

  const jurorDelegateOptions = z.object({
    ...stakeVaultOptionField,
    delegate: z.string().optional().describe("Juror delegate address"),
    ...participantExecutionOptionFields,
  });

  const stake = Cli.create("stake", {
    description: "Stake inspection and participant actions",
  })
    .command("status", {
      description: "Inspect indexed stake position state through canonical tool execution",
      args: z.object({
        identifier: z.string().min(1),
        account: z.string().min(1),
      }),
      output: stakeStatusOutput,
      run(context) {
        return executeStakeStatusCommand(
          {
            identifier: context.args.identifier,
            account: context.args.account,
          },
          deps
        );
      },
    })
    .command("deposit-goal", {
      description: "Deposit goal tokens into a stake vault",
      options: depositOptions,
      output: participantProtocolWriteOutputSchema,
      run(context) {
        return executeStakeDepositGoalCommand(context.options, deps);
      },
    })
    .command("deposit-cobuild", {
      description: "Deposit cobuild tokens into a stake vault",
      options: depositOptions,
      output: participantProtocolWriteOutputSchema,
      run(context) {
        return executeStakeDepositCobuildCommand(context.options, deps);
      },
    })
    .command("opt-in-juror", {
      description: "Lock goal stake as juror weight on a stake vault",
      options: optInJurorOptions,
      output: participantProtocolWriteOutputSchema,
      run(context) {
        return executeStakeOptInJurorCommand(context.options, deps);
      },
    })
    .command("request-juror-exit", {
      description: "Request a juror stake exit from the vault",
      options: jurorGoalAmountOptions,
      output: participantProtocolWriteOutputSchema,
      run(context) {
        return executeStakeRequestJurorExitCommand(context.options, deps);
      },
    })
    .command("finalize-juror-exit", {
      description: "Finalize a juror stake exit from the vault",
      options: jurorVaultOptions,
      output: participantProtocolWriteOutputSchema,
      run(context) {
        return executeStakeFinalizeJurorExitCommand(context.options, deps);
      },
    })
    .command("set-juror-delegate", {
      description: "Update the juror delegate for the stake vault",
      options: jurorDelegateOptions,
      output: participantProtocolWriteOutputSchema,
      run(context) {
        return executeStakeSetJurorDelegateCommand(context.options, deps);
      },
    })
    .command("prepare-underwriter-withdrawal", {
      description: "Prepare underwriter withdrawals on the stake vault",
      options: z.object({
        ...stakeVaultOptionField,
        maxBudgets: z.string().optional().describe("Max budgets to process"),
        ...participantExecutionOptionFields,
      }),
      output: participantProtocolWriteOutputSchema,
      run(context) {
        return executeStakePrepareUnderwriterWithdrawalCommand(context.options, deps);
      },
    })
    .command("withdraw-goal", {
      description: "Withdraw goal stake from the vault",
      options: withdrawOptions,
      output: participantProtocolWriteOutputSchema,
      run(context) {
        return executeStakeWithdrawGoalCommand(context.options, deps);
      },
    })
    .command("withdraw-cobuild", {
      description: "Withdraw cobuild stake from the vault",
      options: withdrawOptions,
      output: participantProtocolWriteOutputSchema,
      run(context) {
        return executeStakeWithdrawCobuildCommand(context.options, deps);
      },
    });

  root.command(stake);

  return [
    commandMetadata("stake status", NETWORK_READ_SCHEMA_METADATA),
    commandMetadata("stake deposit-goal", NETWORK_WRITE_SCHEMA_METADATA),
    commandMetadata("stake deposit-cobuild", NETWORK_WRITE_SCHEMA_METADATA),
    commandMetadata("stake opt-in-juror", NETWORK_WRITE_SCHEMA_METADATA),
    commandMetadata("stake request-juror-exit", NETWORK_WRITE_SCHEMA_METADATA),
    commandMetadata("stake finalize-juror-exit", NETWORK_WRITE_SCHEMA_METADATA),
    commandMetadata("stake set-juror-delegate", NETWORK_WRITE_SCHEMA_METADATA),
    commandMetadata("stake prepare-underwriter-withdrawal", NETWORK_WRITE_SCHEMA_METADATA),
    commandMetadata("stake withdraw-goal", NETWORK_WRITE_SCHEMA_METADATA),
    commandMetadata("stake withdraw-cobuild", NETWORK_WRITE_SCHEMA_METADATA),
  ];
}
