import { parseArgs } from "node:util";
import { configPath, maskToken, readConfig, writeConfig } from "../config.js";
import { printJson } from "../output.js";
import { printUsage } from "../usage.js";
import type { CliDeps } from "../types.js";

const CONFIG_SET_USAGE = "Usage: buildbot config set --url <interface-url> --token <pat> [--agent <key>]";

function normalizeTokenInput(token: string): string {
  return token.trim();
}

function countTokenSources(values: {
  token?: string;
  tokenFile?: string;
  tokenStdin?: boolean;
}): number {
  let count = 0;
  if (typeof values.token === "string") count += 1;
  if (typeof values.tokenFile === "string") count += 1;
  if (values.tokenStdin === true) count += 1;
  return count;
}

function readTokenFromFile(tokenFile: string, deps: Pick<CliDeps, "fs">): string {
  let rawToken: string;
  try {
    rawToken = deps.fs.readFileSync(tokenFile, "utf8");
  } catch (error) {
    throw new Error(
      `Could not read token file: ${tokenFile} (${error instanceof Error ? error.message : String(error)})`
    );
  }

  const token = normalizeTokenInput(rawToken);
  if (!token) {
    throw new Error(`Token file is empty: ${tokenFile}`);
  }

  return token;
}

async function readTokenFromStdin(deps: Pick<CliDeps, "readStdin">): Promise<string> {
  if (deps.readStdin) {
    const token = normalizeTokenInput(await deps.readStdin());
    if (!token) {
      throw new Error("Token stdin input is empty.");
    }
    return token;
  }

  if (process.stdin.isTTY) {
    throw new Error("Refusing --token-stdin from an interactive TTY. Pipe token bytes into stdin.");
  }

  const stdin = process.stdin;
  stdin.setEncoding("utf8");
  const raw = await new Promise<string>((resolve, reject) => {
    let buffer = "";
    stdin.on("data", (chunk: string) => {
      buffer += chunk;
    });
    stdin.once("end", () => resolve(buffer));
    stdin.once("error", reject);
  });

  const token = normalizeTokenInput(raw);
  if (!token) {
    throw new Error("Token stdin input is empty.");
  }
  return token;
}

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
      url: current.url ?? null,
      token: maskToken(current.token),
      agent: current.agent ?? null,
      path: configPath(deps),
    });
    return;
  }

  throw new Error(`Unknown config subcommand: ${subcommand}`);
}
