import { z } from "incur";

export const participantProtocolWriteOutputSchema = z
  .object({
    ok: z.boolean().optional(),
    dryRun: z.boolean().optional(),
    idempotencyKey: z.string(),
    agentKey: z.string().optional(),
    network: z.string(),
    family: z.string(),
    action: z.string(),
    riskClass: z.string(),
    summary: z.string(),
    preconditions: z.array(z.string()),
    expectedEvents: z.array(z.string()).optional(),
    executedStepCount: z.number().optional(),
    steps: z.array(
      z
        .object({
          index: z.number(),
          kind: z.enum(["erc20-approval", "contract-call"]),
          label: z.string(),
          idempotencyKey: z.string(),
          request: z.object({
            method: z.literal("POST"),
            path: z.literal("/api/cli/exec"),
            body: z.unknown(),
          }),
          response: z.unknown().optional(),
        })
        .passthrough()
    ),
  })
  .passthrough();
