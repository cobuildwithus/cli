import { Cli, z } from "incur";
import {
  executeConfigSetCommand,
  executeConfigShowCommand,
} from "../../commands/config.js";
import type { CliDeps } from "../../types.js";

export function registerConfigCommand(root: Cli.Cli, deps: CliDeps): void {
  const configSetOutput = z.object({
    ok: z.literal(true),
    path: z.string(),
  });
  const configShowOutput = z.object({
    interfaceUrl: z.string(),
    chatApiUrl: z.string(),
    token: z.string().nullable(),
    tokenRef: z.unknown().nullable(),
    agent: z.string().nullable(),
    path: z.string(),
  });

  const config = Cli.create("config", {
    description: "Read and write local CLI config",
  })
    .command("set", {
      description: "Persist config values",
      options: z.object({
        url: z.string().optional(),
        chatApiUrl: z.string().optional(),
        token: z.string().optional(),
        tokenFile: z.string().optional(),
        tokenStdin: z.boolean().optional(),
        agent: z.string().optional(),
      }),
      output: configSetOutput,
      run(context) {
        return executeConfigSetCommand(
          {
            url: context.options.url,
            chatApiUrl: context.options.chatApiUrl,
            token: context.options.token,
            tokenFile: context.options.tokenFile,
            tokenStdin: context.options.tokenStdin,
            agent: context.options.agent,
          },
          deps
        );
      },
    })
    .command("show", {
      description: "Print effective config and auth metadata",
      output: configShowOutput,
      run() {
        return executeConfigShowCommand(deps);
      },
    });

  root.command(config);
}
