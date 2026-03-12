import { Cli, z } from "incur";
import {
  executeWalletInitCommand,
  executeWalletStatusCommand,
} from "../../wallet/commands.js";
import type { CliDeps } from "../../types.js";
import {
  commandMetadata,
  mapOptionsToExecutor,
  NETWORK_AND_LOCAL_AUTH_WRITE_SCHEMA_METADATA,
  NETWORK_AND_LOCAL_READ_SCHEMA_METADATA,
  type RegisteredCommandMetadata,
} from "./command-wrapper-shared.js";

export function registerWalletCommand(root: Cli.Cli, deps: CliDeps): RegisteredCommandMetadata[] {
  const walletConfigOutput = z
    .object({
      mode: z.enum(["hosted", "local"]),
      walletAddress: z.string().nullable(),
      network: z.string(),
      token: z.string(),
      costPerPaidCallMicroUsdc: z.string().optional(),
    })
    .strict();
  const walletStatusOutput = z
    .object({
      ok: z.literal(true),
      agentKey: z.string(),
      walletConfig: walletConfigOutput,
    })
    .strict();
  const walletInitOutput = z
    .object({
      ok: z.literal(true),
      agentKey: z.string(),
      walletConfig: walletConfigOutput,
    })
    .strict();
  const walletStatusOptions = z.object({
    agent: z.string().optional(),
  });
  const walletInitOptions = z.object({
    agent: z.string().optional(),
    mode: z.string().optional(),
    privateKeyStdin: z.boolean().optional(),
    privateKeyFile: z.string().optional(),
    prompt: z.boolean().optional(),
  });
  const runWalletStatus = mapOptionsToExecutor(
    deps,
    executeWalletStatusCommand,
    (options: z.infer<typeof walletStatusOptions>) => ({
      agent: options.agent,
    })
  );
  const runWalletInit = mapOptionsToExecutor(
    deps,
    executeWalletInitCommand,
    (options: z.infer<typeof walletInitOptions>) => ({
      agent: options.agent,
      mode: options.mode,
      privateKeyStdin: options.privateKeyStdin,
      privateKeyFile: options.privateKeyFile,
      noPrompt: options.prompt === false,
    })
  );

  const wallet = Cli.create("wallet", {
    description: "Manage wallet configuration",
  })
    .command("status", {
      description: "Print stored wallet configuration and resolved wallet address",
      options: walletStatusOptions,
      output: walletStatusOutput,
      run(context) {
        return runWalletStatus(context) as Promise<z.infer<typeof walletStatusOutput>>;
      },
    })
    .command("init", {
      description: "Initialize wallet configuration for hosted or local execution",
      options: walletInitOptions,
      output: walletInitOutput,
      run(context) {
        return runWalletInit(context) as Promise<z.infer<typeof walletInitOutput>>;
      },
    });

  root.command(wallet);

  return [
    commandMetadata("wallet status", NETWORK_AND_LOCAL_READ_SCHEMA_METADATA),
    commandMetadata("wallet init", NETWORK_AND_LOCAL_AUTH_WRITE_SCHEMA_METADATA),
  ];
}
