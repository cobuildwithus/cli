import { Cli, z } from "incur";
import { executePremiumStatusCommand } from "../../commands/premium.js";
import type { CliDeps } from "../../types.js";

export function registerPremiumCommand(root: Cli.Cli, deps: CliDeps): void {
  const premiumStatusOutput = z
    .object({
      premiumEscrow: z.unknown(),
      ok: z.boolean().optional(),
      untrusted: z.literal(true),
      source: z.literal("remote_tool"),
      warnings: z.array(z.string()),
    })
    .passthrough();

  const premium = Cli.create("premium", {
    description: "Premium escrow inspection",
  }).command("status", {
    description: "Inspect indexed premium escrow state through canonical tool execution",
    args: z.object({
      identifier: z.string().min(1),
    }),
    options: z.object({
      account: z
        .string()
        .refine((value) => value.trim().length > 0, {
          message: "--account cannot be empty.",
        })
        .optional(),
    }),
    output: premiumStatusOutput,
    run(context) {
      return executePremiumStatusCommand(
        {
          identifier: context.args.identifier,
          account: context.options.account,
        },
        deps
      );
    },
  });

  root.command(premium);
}
