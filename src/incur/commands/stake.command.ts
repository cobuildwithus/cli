import { Cli, z } from "incur";
import { executeStakeStatusCommand } from "../../commands/stake.js";
import {
  executeStakeDepositCobuildCommand,
  executeStakeDepositGoalCommand,
  executeStakePrepareUnderwriterWithdrawalCommand,
  executeStakeWithdrawCobuildCommand,
  executeStakeWithdrawGoalCommand,
} from "../../commands/protocol-participant-stake-premium.js";
import { participantProtocolWriteOutputSchema } from "./protocol-participant.command-shared.js";
import type { CliDeps } from "../../types.js";

export function registerStakeCommand(root: Cli.Cli, deps: CliDeps): void {
  const stakeStatusOutput = z
    .object({
      stakePosition: z.unknown(),
      ok: z.boolean().optional(),
      untrusted: z.literal(true),
      source: z.literal("remote_tool"),
      warnings: z.array(z.string()),
    })
    .passthrough();

  const depositOptions = z.object({
    vault: z.string().optional().describe("Stake vault address"),
    token: z.string().optional().describe("Token address"),
    amount: z.string().optional().describe("Atomic token amount"),
    approvalMode: z
      .enum(["auto", "force", "skip"])
      .optional()
      .describe("Approval behavior"),
    currentAllowance: z.string().optional().describe("Current ERC-20 allowance"),
    approvalAmount: z.string().optional().describe("Override approval amount"),
    network: z.string().optional().describe("Execution network"),
    agent: z.string().optional().describe("Agent key"),
    idempotencyKey: z.string().optional().describe("Idempotency key"),
    dryRun: z.boolean().optional().describe("Print the execution plan without sending"),
  });

  const withdrawOptions = z.object({
    vault: z.string().optional().describe("Stake vault address"),
    amount: z.string().optional().describe("Atomic token amount"),
    recipient: z.string().optional().describe("Recipient address"),
    network: z.string().optional().describe("Execution network"),
    agent: z.string().optional().describe("Agent key"),
    idempotencyKey: z.string().optional().describe("Idempotency key"),
    dryRun: z.boolean().optional().describe("Print the execution plan without sending"),
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
    .command("prepare-underwriter-withdrawal", {
      description: "Prepare underwriter withdrawals on the stake vault",
      options: z.object({
        vault: z.string().optional().describe("Stake vault address"),
        maxBudgets: z.string().optional().describe("Max budgets to process"),
        network: z.string().optional().describe("Execution network"),
        agent: z.string().optional().describe("Agent key"),
        idempotencyKey: z.string().optional().describe("Idempotency key"),
        dryRun: z.boolean().optional().describe("Print the execution plan without sending"),
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
}
