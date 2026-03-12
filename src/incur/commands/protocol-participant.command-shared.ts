import { z } from "incur";

export const participantExecutionOptionShape = {
  network: z.string().optional().describe("Execution network"),
  agent: z.string().optional().describe("Agent key"),
  idempotencyKey: z.string().optional().describe("Idempotency key"),
  dryRun: z.boolean().optional().describe("Print the execution plan without sending"),
} as const;

export const participantProtocolWriteOutputSchema = z
  .object({
    ok: z.boolean().optional(),
    dryRun: z.boolean().optional(),
    idempotencyKey: z.string(),
    agentKey: z.string().optional(),
    walletMode: z.string().optional(),
    network: z.string(),
    family: z.string(),
    action: z.string(),
    riskClass: z.string(),
    summary: z.string(),
    preconditions: z.array(z.string()),
    expectedEvents: z.array(z.string()).optional(),
    stepCount: z.number().optional(),
    executedStepCount: z.number().optional(),
    replayedStepCount: z.number().optional(),
    warnings: z.array(z.string()).optional(),
    steps: z.array(
      z
        .object({
          stepNumber: z.number(),
          kind: z.enum(["erc20-approval", "contract-call"]),
          label: z.string(),
          displayLabel: z.string(),
          idempotencyKey: z.string(),
          executionTarget: z.string(),
          transaction: z.unknown(),
          request: z.unknown(),
          status: z.string(),
          warnings: z.array(z.string()),
          result: z.unknown().optional(),
          transactionHash: z.string().optional(),
          explorerUrl: z.string().optional(),
          replayed: z.boolean().optional(),
          receiptSummary: z.unknown().optional(),
          receiptDecodeError: z.string().optional(),
          contract: z.string().optional(),
          functionName: z.string().optional(),
          tokenAddress: z.string().optional(),
          spenderAddress: z.string().optional(),
          amount: z.string().optional(),
        })
        .strict()
    ),
  })
  .passthrough();
