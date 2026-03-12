import { Cli, z } from "incur";
import {
  executeFarcasterPostCommand,
  executeFarcasterSignupCommand,
} from "../../commands/farcaster.js";
import type { CliDeps } from "../../types.js";
import {
  forwardOptionsToExecutor,
  mapOptionsToExecutor,
} from "./command-wrapper-shared.js";

export function registerFarcasterCommand(root: Cli.Cli, deps: CliDeps): void {
  const farcasterSignerOutput = z.object({
    publicKey: z.string(),
    saved: z.boolean(),
    file: z.string(),
  });
  const farcasterSignupOutput = z
    .object({
      ok: z.boolean().optional(),
      result: z.unknown().optional(),
      signer: farcasterSignerOutput.optional(),
    })
    .passthrough();
  const farcasterPostOutput = z
    .object({
      ok: z.boolean().optional(),
      replayed: z.boolean().optional(),
      resumedPending: z.boolean().optional(),
      dryRun: z.boolean().optional(),
      idempotencyKey: z.string(),
      request: z.unknown().optional(),
      result: z
        .object({
          fid: z.number().optional(),
          text: z.string().optional(),
          parentAuthorFid: z.number().optional(),
          parentHashHex: z.string().optional(),
          castHashHex: z.string().optional(),
          hubResponseStatus: z.number().optional(),
          hubResponse: z.unknown().optional(),
          payerAddress: z.string().nullable().optional(),
          payerAgentKey: z.string().optional(),
          x402Token: z.string().nullable().optional(),
          x402Amount: z.string().nullable().optional(),
          x402Network: z.string().nullable().optional(),
          verification: z
            .object({
              enabled: z.literal(true),
              included: z.literal(true),
              attempts: z.number(),
            })
            .optional(),
        })
        .passthrough()
        .optional(),
    })
    .passthrough();
  const farcasterSignupOptions = z.object({
    agent: z.string().optional(),
    recovery: z.string().optional(),
    extraStorage: z.string().optional(),
    outDir: z.string().optional(),
  });
  const farcasterPostOptions = z.object({
    agent: z.string().optional(),
    text: z.string().optional(),
    fid: z.coerce.number().int().positive().optional(),
    replyTo: z.string().optional(),
    signerFile: z.string().optional(),
    idempotencyKey: z.string().optional(),
    verify: z.enum(["none", "once", "poll"]).optional(),
    dryRun: z.boolean().optional(),
  });
  const runFarcasterSignup = forwardOptionsToExecutor(deps, executeFarcasterSignupCommand);
  const runFarcasterPost = mapOptionsToExecutor(
    deps,
    executeFarcasterPostCommand,
    (options: z.infer<typeof farcasterPostOptions>) => ({
      agent: options.agent,
      text: options.text,
      fid: options.fid !== undefined ? String(options.fid) : undefined,
      replyTo: options.replyTo,
      signerFile: options.signerFile,
      idempotencyKey: options.idempotencyKey,
      verify: options.verify,
      dryRun: options.dryRun,
    })
  );

  const farcaster = Cli.create("farcaster", {
    description: "Manage Farcaster signup/posting",
  })
    .command("signup", {
      description: "Create Farcaster account and signer metadata",
      options: farcasterSignupOptions,
      output: farcasterSignupOutput,
      run(context) {
        return runFarcasterSignup(context) as Promise<z.infer<typeof farcasterSignupOutput>>;
      },
    })
    .command("post", {
      description: "Submit a cast via Neynar hub",
      options: farcasterPostOptions,
      output: farcasterPostOutput,
      run(context) {
        return runFarcasterPost(context) as Promise<z.infer<typeof farcasterPostOutput>>;
      },
    });

  root.command(farcaster);
}
