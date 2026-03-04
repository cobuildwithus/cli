import { createCobuildIncurCli, preprocessIncurArgv } from "./cli-incur.js";
import { defaultDeps } from "./deps.js";
import type { CliDeps } from "./types.js";

class IncurExitSignal extends Error {
  readonly code: number;

  constructor(code: number) {
    super(`Incur exited with code ${code}`);
    this.code = code;
  }
}

function stripTrailingNewline(value: string): string {
  if (value.endsWith("\r\n")) {
    return value.slice(0, -2);
  }
  if (value.endsWith("\n")) {
    return value.slice(0, -1);
  }
  return value;
}

function normalizeCommandNotFoundMessage(message: string): string {
  const match =
    message.match(
      /^'([^']+)' is not a command\. See 'cli(?:\s+([^']+))? --help' for a list of available commands\.$/
    ) ?? message.match(/^'([^']+)' is not a command for 'cli(?:\s+([^']+))?'\.$/);
  if (!match) return message;

  const command = match[1];
  const path = match[2]?.trim();
  if (!path) {
    return `Unknown command: ${command}`;
  }

  return `Unknown ${path} subcommand: ${command}`;
}

function parseJsonMessage(value: string): string | null {
  try {
    const parsed = JSON.parse(value) as { message?: unknown; error?: { message?: unknown } };
    if (typeof parsed.message === "string" && parsed.message.trim().length > 0) {
      return normalizeCommandNotFoundMessage(parsed.message);
    }
    if (typeof parsed.error?.message === "string" && parsed.error.message.trim().length > 0) {
      return normalizeCommandNotFoundMessage(parsed.error.message);
    }
    return null;
  } catch {
    return null;
  }
}

function extractIncurErrorMessage(outputs: string[], exitCode: number): string {
  const joined = outputs.join("\n").trim();
  if (!joined) return `Command failed with exit code ${exitCode}.`;

  const parsedJoined = parseJsonMessage(joined);
  if (parsedJoined) {
    return parsedJoined;
  }

  const lines = joined.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const lastLine = lines.at(-1) ?? joined;
  const parsedLastLine = parseJsonMessage(lastLine);
  if (parsedLastLine) {
    return parsedLastLine;
  }
  const standardError = lastLine.match(/^Error(?:\s+\([^)]*\))?:\s+(.+)$/);
  if (standardError) {
    return standardError[1] ?? `Command failed with exit code ${exitCode}.`;
  }

  return normalizeCommandNotFoundMessage(joined);
}

function isMcpRequested(argv: string[]): boolean {
  let index = 0;
  while (index < argv.length) {
    const token = argv[index]!;
    if (token === "--") return false;
    if (!token.startsWith("-")) return false;
    if (token === "--mcp") return true;

    if (token === "--format") {
      index += 2;
      continue;
    }
    if (token.startsWith("--format=")) {
      index += 1;
      continue;
    }

    if (
      token === "--verbose" ||
      token === "--json" ||
      token === "--llms" ||
      token === "--help" ||
      token === "-h" ||
      token === "--version"
    ) {
      index += 1;
      continue;
    }

    return false;
  }
  return false;
}

export function createCliDeps(overrides: Partial<CliDeps> = {}): CliDeps {
  return {
    ...defaultDeps,
    ...overrides,
  };
}

function flushOutputBuffer(outputBuffer: string[], write: CliDeps["stdout"]): void {
  for (const message of outputBuffer) {
    write(message);
  }
}

export async function runCli(argv: string[], deps: CliDeps): Promise<void> {
  const normalizedArgv = [...argv];
  if (normalizedArgv[0] === "--") {
    normalizedArgv.shift();
  }

  const mcpRequested = isMcpRequested(normalizedArgv);
  const cliDeps = mcpRequested
    ? {
        ...deps,
        isInteractive: () => false,
        readStdin: async () => {
          throw new Error(
            "stdin is reserved for MCP; use explicit flags or file options instead of --*-stdin."
          );
        },
      }
    : deps;
  const cli = createCobuildIncurCli(cliDeps, { mcpMode: mcpRequested });
  const outputBuffer: string[] = [];
  const serveArgv = preprocessIncurArgv(normalizedArgv);
  const outputWriter = mcpRequested
    ? undefined
    : (chunk: string) => {
        const message = stripTrailingNewline(chunk);
        outputBuffer.push(message);
      };

  try {
    await cli.serve(serveArgv, {
      env: deps.env,
      ...(outputWriter ? { stdout: outputWriter } : {}),
      exit: (code) => {
        throw new IncurExitSignal(code);
      },
    });
  } catch (error) {
    if (error instanceof IncurExitSignal) {
      if (error.code === 0) {
        if (!mcpRequested) {
          flushOutputBuffer(outputBuffer, deps.stdout);
        }
        return;
      }
      throw new Error(extractIncurErrorMessage(outputBuffer, error.code));
    }
    throw error;
  }

  if (!mcpRequested) {
    flushOutputBuffer(outputBuffer, deps.stdout);
  }
}

export async function runCliFromProcess(
  processArgv: string[] = process.argv,
  overrides: Partial<CliDeps> = {}
): Promise<void> {
  const deps = createCliDeps(overrides);

  try {
    await runCli(processArgv.slice(2), deps);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.stderr(`Error: ${message}`);
    deps.exit(1);
  }
}
