import { Cli, z } from "incur";
import {
  executeRevnetCashOutCommand,
  executeRevnetIssuanceTermsCommand,
  executeRevnetLoanCommand,
  executeRevnetPayCommand,
} from "../../commands/revnet.js";
import type { CliDeps } from "../../types.js";

export function registerRevnetCommand(root: Cli.Cli, deps: CliDeps): void {
  const revnetWriteOutput = z
    .object({
      idempotencyKey: z.string(),
    })
    .passthrough();
  const issuanceTermsOutput = z
    .object({
      terms: z.unknown(),
      ok: z.boolean().optional(),
      untrusted: z.literal(true),
      source: z.literal("remote_tool"),
      warnings: z.array(z.string()),
    })
    .passthrough();

  const revnet = Cli.create("revnet", {
    description: "REVnet payment, cash-out, loan, and indexed issuance terms commands",
  })
    .command("pay", {
      description: "Pay native ETH into a revnet",
      options: z.object({
        amount: z.string().optional(),
        projectId: z.string().optional(),
        beneficiary: z.string().optional(),
        minReturnedTokens: z.string().optional(),
        memo: z.string().optional(),
        metadata: z.string().optional(),
        network: z.string().optional(),
        agent: z.string().optional(),
        idempotencyKey: z.string().optional(),
        dryRun: z.boolean().optional(),
      }),
      output: revnetWriteOutput,
      run(context) {
        return executeRevnetPayCommand(context.options, deps);
      },
    })
    .command("cash-out", {
      description: "Cash out revnet tokens through the configured terminal",
      options: z.object({
        cashOutCount: z.string().optional(),
        projectId: z.string().optional(),
        beneficiary: z.string().optional(),
        minReclaimAmount: z.string().optional(),
        preferredBaseToken: z.string().optional(),
        metadata: z.string().optional(),
        network: z.string().optional(),
        agent: z.string().optional(),
        idempotencyKey: z.string().optional(),
        dryRun: z.boolean().optional(),
      }),
      output: revnetWriteOutput,
      run(context) {
        return executeRevnetCashOutCommand(context.options, deps);
      },
    })
    .command("loan", {
      description: "Take a revnet loan using the configured wallet position as collateral",
      options: z.object({
        collateralCount: z.string().optional(),
        repayYears: z.string().optional(),
        projectId: z.string().optional(),
        beneficiary: z.string().optional(),
        minBorrowAmount: z.string().optional(),
        preferredBaseToken: z.string().optional(),
        preferredLoanToken: z.string().optional(),
        permissionMode: z.string().optional(),
        network: z.string().optional(),
        agent: z.string().optional(),
        idempotencyKey: z.string().optional(),
        dryRun: z.boolean().optional(),
      }),
      output: revnetWriteOutput,
      run(context) {
        return executeRevnetLoanCommand(context.options, deps);
      },
    })
    .command("issuance-terms", {
      description:
        "Fetch indexed revnet issuance terms through canonical tool execution (defaults to the configured Cobuild project)",
      options: z.object({
        projectId: z.string().optional(),
      }),
      output: issuanceTermsOutput,
      run(context) {
        return executeRevnetIssuanceTermsCommand(context.options, deps);
      },
    });

  root.command(revnet);
}
