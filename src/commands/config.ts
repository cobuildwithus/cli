import { parseArgs } from "node:util";
import { configPath, persistPatToken, readConfig, resolveMaskedToken, writeConfig } from "../config.js";
import { printJson } from "../output.js";
import { printUsage } from "../usage.js";
import type { CliDeps } from "../types.js";
import { countTokenSources, normalizeTokenInput, readTokenFromFile, readTokenFromStdin } from "./shared.js";
import { isSecretRef } from "../secrets/ref-contract.js";

const CONFIG_SET_USAGE =
  "Usage: cli config set --url <interface-url> --token <pat>|--token-file <path>|--token-stdin [--agent <key>]";

export interface ConfigSetCommandInput {
  url?: string;
  token?: string;
  tokenFile?: string;
  tokenStdin?: boolean;
  agent?: string;
}

export interface ConfigSetCommandOutput {
  ok: true;
  path: string;
}

export interface ConfigShowCommandOutput {
  interfaceUrl: string | null;
  token: string | null;
  tokenRef: unknown;
  agent: string | null;
  path: string;
}

export async function executeConfigSetCommand(
  input: ConfigSetCommandInput,
  deps: CliDeps
): Promise<ConfigSetCommandOutput> {
  const tokenSourceCount = countTokenSources({
    token: input.token,
    tokenFile: input.tokenFile,
    tokenStdin: input.tokenStdin,
  });
  if (tokenSourceCount > 1) {
    throw new Error(
      `${CONFIG_SET_USAGE}\nProvide only one of --token, --token-file, or --token-stdin.`
    );
  }

  let tokenFromOption: string | undefined;
  if (typeof input.token === "string") {
    tokenFromOption = normalizeTokenInput(input.token);
  } else if (typeof input.tokenFile === "string") {
    tokenFromOption = readTokenFromFile(input.tokenFile, deps);
  } else if (input.tokenStdin === true) {
    tokenFromOption = await readTokenFromStdin(deps);
  }
  if (tokenFromOption !== undefined && tokenFromOption.length === 0) {
    throw new Error("Token cannot be empty");
  }

  const hasUpdate =
    typeof input.url === "string" ||
    tokenFromOption !== undefined ||
    typeof input.agent === "string";
  if (!hasUpdate) {
    throw new Error(CONFIG_SET_USAGE);
  }

  const current = readConfig(deps);
  let next = { ...current };
  if (typeof input.url === "string") {
    next.url = input.url;
  }
  if (tokenFromOption !== undefined) {
    next = persistPatToken({
      deps,
      config: next,
      token: tokenFromOption,
      interfaceUrl: next.url,
    });
  }
  if (typeof input.agent === "string") {
    next.agent = input.agent;
  }

  writeConfig(deps, next);
  return {
    ok: true,
    path: configPath(deps),
  };
}

export function executeConfigShowCommand(deps: CliDeps): ConfigShowCommandOutput {
  const current = readConfig(deps);
  return {
    interfaceUrl: current.url ?? null,
    token: resolveMaskedToken(deps, current),
    tokenRef: isSecretRef(current.auth?.tokenRef) ? current.auth.tokenRef : null,
    agent: current.agent ?? null,
    path: configPath(deps),
  };
}

/* c8 ignore start */
export async function handleConfigCommand(args: string[], deps: CliDeps): Promise<void> {
  const subcommand = args[0];
  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    printUsage(deps);
    return;
  }

  if (subcommand === "set") {
    const parsed = parseArgs({
      options: {
        url: { type: "string" },
        token: { type: "string" },
        "token-file": { type: "string" },
        "token-stdin": { type: "boolean" },
        agent: { type: "string" },
      },
      args: args.slice(1),
      allowPositionals: false,
      strict: true,
    });

    const output = await executeConfigSetCommand(
      {
        url: parsed.values.url,
        token: parsed.values.token,
        tokenFile: parsed.values["token-file"],
        tokenStdin: parsed.values["token-stdin"],
        agent: parsed.values.agent,
      },
      deps
    );
    deps.stdout(`Saved config: ${output.path}`);
    return;
  }

  if (subcommand === "show") {
    printJson(deps, executeConfigShowCommand(deps));
    return;
  }

  throw new Error(`Unknown config subcommand: ${subcommand}`);
}
/* c8 ignore stop */
