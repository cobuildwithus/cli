import { parseArgs } from "node:util";
import { configPath, maskToken, readConfig, writeConfig } from "../config.js";
import { printJson } from "../output.js";
import { printUsage } from "../usage.js";
import type { CliDeps } from "../types.js";
import { countTokenSources, normalizeTokenInput, readTokenFromFile, readTokenFromStdin } from "./shared.js";

const CONFIG_SET_USAGE =
  "Usage: buildbot config set --url <interface-url> [--chat-api-url <chat-api-url>] --token <pat>|--token-file <path>|--token-stdin [--agent <key>]";

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
        "chat-api-url": { type: "string" },
        token: { type: "string" },
        "token-file": { type: "string" },
        "token-stdin": { type: "boolean" },
        agent: { type: "string" },
      },
      args: args.slice(1),
      allowPositionals: false,
      strict: true,
    });

    const tokenSourceCount = countTokenSources({
      token: parsed.values.token,
      tokenFile: parsed.values["token-file"],
      tokenStdin: parsed.values["token-stdin"],
    });
    if (tokenSourceCount > 1) {
      throw new Error(
        `${CONFIG_SET_USAGE}\nProvide only one of --token, --token-file, or --token-stdin.`
      );
    }

    let tokenFromOption: string | undefined;
    if (typeof parsed.values.token === "string") {
      tokenFromOption = normalizeTokenInput(parsed.values.token);
    } else if (typeof parsed.values["token-file"] === "string") {
      tokenFromOption = readTokenFromFile(parsed.values["token-file"], deps);
    } else if (parsed.values["token-stdin"] === true) {
      tokenFromOption = await readTokenFromStdin(deps);
    }
    if (tokenFromOption !== undefined && tokenFromOption.length === 0) {
      throw new Error("Token cannot be empty");
    }

    const hasUpdate =
      typeof parsed.values.url === "string" ||
      typeof parsed.values["chat-api-url"] === "string" ||
      tokenFromOption !== undefined ||
      typeof parsed.values.agent === "string";
    if (!hasUpdate) {
      throw new Error(CONFIG_SET_USAGE);
    }

    const current = readConfig(deps);
    const next = { ...current };
    if (typeof parsed.values.url === "string") {
      next.url = parsed.values.url;
    }
    if (typeof parsed.values["chat-api-url"] === "string") {
      next.chatApiUrl = parsed.values["chat-api-url"];
    }
    if (tokenFromOption !== undefined) {
      next.token = tokenFromOption;
    }
    if (typeof parsed.values.agent === "string") {
      next.agent = parsed.values.agent;
    }

    writeConfig(deps, next);
    deps.stdout(`Saved config: ${configPath(deps)}`);
    return;
  }

  if (subcommand === "show") {
    const current = readConfig(deps);
    printJson(deps, {
      interfaceUrl: current.url ?? null,
      chatApiUrl: current.chatApiUrl ?? null,
      token: maskToken(current.token),
      agent: current.agent ?? null,
      path: configPath(deps),
    });
    return;
  }

  throw new Error(`Unknown config subcommand: ${subcommand}`);
}
