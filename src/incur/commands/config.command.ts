import { Cli, z } from "incur";
import {
  executeConfigSetCommand,
  executeConfigShowCommand,
} from "../../commands/config.js";
import type { CliDeps } from "../../types.js";
import { forwardOptionsToExecutor } from "./command-wrapper-shared.js";

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
  const configSetOptions = z.object({
    url: z.string().optional(),
    chatApiUrl: z.string().optional(),
    token: z.string().optional(),
    tokenFile: z.string().optional(),
    tokenStdin: z.boolean().optional(),
    tokenEnv: z.string().optional(),
    tokenExec: z.string().optional(),
    tokenRefJson: z.string().optional(),
    agent: z.string().optional(),
  });
  const runConfigSet = forwardOptionsToExecutor(deps, executeConfigSetCommand);

  const config = Cli.create("config", {
    description: "Read and write local CLI config",
  })
    .command("set", {
      description: "Persist config values",
      options: configSetOptions,
      output: configSetOutput,
      run: runConfigSet,
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
