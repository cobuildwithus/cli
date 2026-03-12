import { Cli, z } from "incur";
import { executeDocsCommand } from "../../commands/docs.js";
import type { CliDeps } from "../../types.js";
import {
  commandMetadata,
  NETWORK_READ_SCHEMA_METADATA,
  type RegisteredCommandMetadata,
} from "./command-wrapper-shared.js";

export function registerDocsCommand(
  root: Cli.Cli,
  deps: CliDeps,
  decodeEscapedPositional: (value: string) => string
): RegisteredCommandMetadata[] {
  const docsArgs = z.object({
    query: z.string().min(1),
  });
  const docsOptions = z.object({
    limit: z.coerce.number().int().min(1).max(20).optional(),
  });
  const docsOutput = z.object({
    query: z.string(),
    count: z.number(),
    results: z.array(z.unknown()),
    untrusted: z.literal(true),
    source: z.literal("remote_tool"),
    warnings: z.array(z.string()),
  });

  root.command("docs", {
    description: "Search Cobuild docs",
    args: docsArgs,
    options: docsOptions,
    output: docsOutput,
    run(context) {
      return executeDocsCommand(
        {
          query: decodeEscapedPositional(context.args.query),
          limit: context.options.limit !== undefined ? String(context.options.limit) : undefined,
        },
        deps
      );
    },
  });

  return [commandMetadata("docs", NETWORK_READ_SCHEMA_METADATA)];
}
