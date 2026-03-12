import { Cli, z } from "incur";
import { executeSendCommand } from "./commands/send.js";
import { executeSetupCommand } from "./commands/setup.js";
import { executeTxCommand } from "./commands/tx.js";
import { registerConfigCommand } from "./incur/commands/config.command.js";
import { registerBudgetCommand } from "./incur/commands/budget.command.js";
import { registerCommunityCommand } from "./incur/commands/community.command.js";
import { registerDocsCommand } from "./incur/commands/docs.command.js";
import { registerFarcasterCommand } from "./incur/commands/farcaster.command.js";
import { registerFlowCommand } from "./incur/commands/flow.command.js";
import { registerGoalCommand } from "./incur/commands/goal.command.js";
import { registerPremiumCommand } from "./incur/commands/premium.command.js";
import { registerRevnetCommand } from "./incur/commands/revnet.command.js";
import { registerStakeCommand } from "./incur/commands/stake.command.js";
import { registerTcrCommand } from "./incur/commands/tcr.command.js";
import { registerToolsCommand } from "./incur/commands/tools.command.js";
import { registerVoteCommand } from "./incur/commands/vote.command.js";
import { registerWalletCommand } from "./incur/commands/wallet.command.js";
import {
  addRegisteredCommandMetadata,
  commandMetadata,
  DEFAULT_COMMAND_SCHEMA_METADATA,
  INTROSPECTION_SCHEMA_METADATA,
  NETWORK_AND_LOCAL_SETUP_SCHEMA_METADATA,
  NETWORK_WRITE_SCHEMA_METADATA,
  normalizeCommandPath,
  type CommandSchemaMetadata,
} from "./incur/commands/command-wrapper-shared.js";
import type { CliDeps } from "./types.js";

const POSITIONAL_ESCAPE_PREFIX = "__incur_positional_b64__";
const LEADING_GLOBAL_BOOLEAN_FLAGS = new Set([
  "--verbose",
  "--json",
  "--llms",
  "--llms-full",
  "--mcp",
  "--schema",
  "--token-count",
  "--help",
  "-h",
  "--version",
]);
const LEADING_GLOBAL_VALUE_FLAGS = new Set([
  "--filter-output",
  "--format",
  "--token-limit",
  "--token-offset",
]);

export interface CobuildIncurCliOptions {
  mcpMode?: boolean;
}

function encodeEscapedPositional(value: string): string {
  return `${POSITIONAL_ESCAPE_PREFIX}${Buffer.from(value, "utf8").toString("base64url")}`;
}

function decodeEscapedPositional(value: string): string {
  if (!value.startsWith(POSITIONAL_ESCAPE_PREFIX)) return value;
  const encoded = value.slice(POSITIONAL_ESCAPE_PREFIX.length);
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) {
    return value;
  }
  try {
    const decoded = Buffer.from(encoded, "base64url");
    if (decoded.toString("base64url") !== encoded) {
      return value;
    }
    return decoded.toString("utf8");
  } catch {
    return value;
  }
}

function normalizeFarcasterSignupArgv(argv: string[]): string[] {
  if (argv[0] !== "farcaster" || argv[1] !== "signup") return argv;

  const normalized = argv.slice(0, 2);
  for (let index = 2; index < argv.length; index += 1) {
    const current = argv[index]!;
    const next = argv[index + 1];

    if (current === "--extra-storage" && typeof next === "string" && /^-\d+$/.test(next)) {
      normalized.push(`--extra-storage=${next}`);
      index += 1;
      continue;
    }

    normalized.push(current);
  }

  return normalized;
}

function normalizeFarcasterPostArgv(argv: string[]): string[] {
  if (argv[0] !== "farcaster" || argv[1] !== "post") return argv;

  const normalized: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index]!;
    const next = argv[index + 1];

    if (current === "--verify" && (next === undefined || next.startsWith("-"))) {
      normalized.push("--verify=once");
      continue;
    }

    normalized.push(current);
  }

  return normalized;
}

interface EscapedPositionalFlagConsumption {
  consumed: number;
  tokens: string[];
}

function consumeOptionalFlagValueArgvToken(
  argv: string[],
  index: number,
  flag: string
): EscapedPositionalFlagConsumption | null {
  if (argv[index] !== flag) {
    return null;
  }

  const tokens = [flag];
  const next = argv[index + 1];
  if (typeof next === "string") {
    tokens.push(next);
  }

  return {
    consumed: tokens.length,
    tokens,
  };
}

function normalizeEscapedPositionalTailArgv(
  argv: string[],
  prefix: string[],
  consumeFlag?: (
    argv: string[],
    index: number,
    positionalOnly: boolean
  ) => EscapedPositionalFlagConsumption | null
): string[] {
  if (
    prefix.length === 0 ||
    prefix.some((segment, index) => argv[index] !== segment)
  ) {
    return argv;
  }

  const normalized = [...prefix];
  const positionalWords: string[] = [];
  let positionalOnly = false;

  for (let index = prefix.length; index < argv.length; index += 1) {
    const current = argv[index]!;
    if (current === "--") {
      positionalOnly = true;
      continue;
    }

    const consumed = consumeFlag?.(argv, index, positionalOnly);
    if (consumed) {
      normalized.push(...consumed.tokens);
      index += consumed.consumed - 1;
      continue;
    }

    if (!positionalOnly && current.startsWith("-")) {
      normalized.push(current);
      continue;
    }

    positionalWords.push(current);
  }

  if (positionalWords.length > 0) {
    normalized.push(encodeEscapedPositional(positionalWords.join(" ")));
  }

  return normalized;
}

function normalizeDocsArgv(argv: string[]): string[] {
  return normalizeEscapedPositionalTailArgv(argv, ["docs"], (tokens, index, positionalOnly) => {
    if (positionalOnly) {
      return null;
    }

    return consumeOptionalFlagValueArgvToken(tokens, index, "--limit");
  });
}

function normalizeToolsArgv(argv: string[]): string[] {
  const subcommand = argv[1];
  if (argv[0] !== "tools" || (subcommand !== "get-user" && subcommand !== "get-cast")) {
    return argv;
  }

  return normalizeEscapedPositionalTailArgv(
    argv,
    ["tools", subcommand],
    (tokens, index, positionalOnly) => {
      if (positionalOnly || subcommand !== "get-cast") {
        return null;
      }

      const current = tokens[index]!;
      const consumedTypeFlag = consumeOptionalFlagValueArgvToken(tokens, index, "--type");
      if (consumedTypeFlag) {
        return consumedTypeFlag;
      }

      if (current.startsWith("--type=")) {
        return {
          consumed: 1,
          tokens: [current],
        };
      }

      return null;
    }
  );
}

function normalizeSchemaArgv(argv: string[]): string[] {
  return normalizeEscapedPositionalTailArgv(argv, ["schema"]);
}

function normalizeSetupArgv(argv: string[]): string[] {
  if (argv[0] !== "setup") return argv;
  return argv.map((token) => (token === "--json" ? "--setup-json" : token));
}

const COMMAND_TAIL_NORMALIZERS = [
  normalizeFarcasterSignupArgv,
  normalizeFarcasterPostArgv,
  normalizeDocsArgv,
  normalizeToolsArgv,
  normalizeSchemaArgv,
  normalizeSetupArgv,
] as const;

function consumeLeadingGlobalFlag(argv: string[], index: number): number {
  const token = argv[index]!;

  if (LEADING_GLOBAL_BOOLEAN_FLAGS.has(token)) {
    return index + 1;
  }

  for (const flag of LEADING_GLOBAL_VALUE_FLAGS) {
    if (token === flag) {
      if (index + 1 < argv.length) {
        return index + 2;
      }
      return index + 1;
    }

    if (token.startsWith(`${flag}=`)) {
      return index + 1;
    }
  }

  return index;
}

export function splitLeadingGlobalArgv(argv: string[]): { leading: string[]; tail: string[] } {
  let index = 0;
  while (index < argv.length) {
    const token = argv[index]!;
    if (token === "--") break;
    if (!token.startsWith("-")) break;

    const consumed = consumeLeadingGlobalFlag(argv, index);
    if (consumed === index) break;
    index = consumed;
  }

  return {
    leading: argv.slice(0, index),
    tail: argv.slice(index),
  };
}

export function preprocessIncurArgv(argv: string[]): string[] {
  const { leading, tail } = splitLeadingGlobalArgv(argv);
  if (tail.length === 0) {
    return argv;
  }

  let normalizedLeading = [...leading];
  let normalizedTail = [...tail];

  if (normalizedTail[0] === "setup") {
    let setupJsonRequestedFromLeading = false;
    normalizedLeading = normalizedLeading.filter((token) => {
      if (token === "--json") {
        setupJsonRequestedFromLeading = true;
        return false;
      }
      return true;
    });

    if (setupJsonRequestedFromLeading && !normalizedTail.includes("--setup-json")) {
      normalizedTail = [normalizedTail[0]!, "--setup-json", ...normalizedTail.slice(1)];
    }
  }

  const commandNormalizedTail = COMMAND_TAIL_NORMALIZERS.reduce(
    (currentArgv, normalize) => normalize(currentArgv),
    normalizedTail
  );

  return [...normalizedLeading, ...commandNormalizedTail];
}

interface IncurManifestCommandEntry {
  name?: string;
  description?: string;
  schema?: unknown;
  examples?: unknown;
}

interface IncurManifest {
  version?: string;
  commands?: IncurManifestCommandEntry[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readIncurManifest(cli: Cli.Cli, deps: CliDeps): Promise<IncurManifest> {
  const output: string[] = [];
  await cli.serve(["--llms-full", "--format", "json"], {
    env: deps.env,
    stdout: (chunk) => {
      output.push(chunk);
    },
    exit: (code) => {
      throw new Error(`Failed to load command schema manifest (exit ${code}).`);
    },
  });

  const raw = output.join("").trim();
  if (!raw) {
    throw new Error("Failed to load command schema manifest: empty --llms-full output.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Failed to parse command schema manifest JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (!isRecord(parsed)) {
    throw new Error("Failed to load command schema manifest: unexpected payload shape.");
  }
  return parsed as IncurManifest;
}

export function createCobuildIncurCli(deps: CliDeps, options: CobuildIncurCliOptions = {}): Cli.Cli {
  const setupOutput = z.object({
    ok: z.literal(true),
    config: z.object({
      interfaceUrl: z.string(),
      chatApiUrl: z.string(),
      agent: z.string(),
      path: z.string(),
    }),
    defaultNetwork: z.string(),
    wallet: z.unknown(),
    walletConfig: z
      .object({
        mode: z.enum(["hosted", "local"]),
        walletAddress: z.string().nullable(),
        network: z.string(),
        token: z.string(),
        costPerPaidCallMicroUsdc: z.string(),
      })
      .optional(),
    next: z.array(z.string()),
  });
  const sendOrTxOutput = z
    .object({
      idempotencyKey: z.string(),
    })
    .passthrough();

  const root = Cli.create("cli", {
    description: "Cobuild CLI",
    format: "json",
    mcp: {
      command: "npx @cobuild/cli --mcp",
    },
    sync: {
      suggestions: [
        "configure the Cobuild CLI",
        "search docs with cli docs",
        "run cli wallet status",
      ],
    },
  });

  const commandSchemaMetadata = new Map<string, CommandSchemaMetadata>();
  addRegisteredCommandMetadata(commandSchemaMetadata, registerConfigCommand(root, deps));
  addRegisteredCommandMetadata(commandSchemaMetadata, registerBudgetCommand(root, deps));
  addRegisteredCommandMetadata(commandSchemaMetadata, registerCommunityCommand(root, deps));
  addRegisteredCommandMetadata(commandSchemaMetadata, registerFlowCommand(root, deps));
  addRegisteredCommandMetadata(commandSchemaMetadata, registerGoalCommand(root, deps));
  addRegisteredCommandMetadata(commandSchemaMetadata, registerTcrCommand(root, deps));
  addRegisteredCommandMetadata(commandSchemaMetadata, registerVoteCommand(root, deps));
  addRegisteredCommandMetadata(commandSchemaMetadata, registerStakeCommand(root, deps));
  addRegisteredCommandMetadata(commandSchemaMetadata, registerPremiumCommand(root, deps));
  addRegisteredCommandMetadata(commandSchemaMetadata, registerRevnetCommand(root, deps));
  addRegisteredCommandMetadata(commandSchemaMetadata, registerWalletCommand(root, deps));
  addRegisteredCommandMetadata(commandSchemaMetadata, registerFarcasterCommand(root, deps));
  addRegisteredCommandMetadata(commandSchemaMetadata, registerDocsCommand(root, deps, decodeEscapedPositional));
  addRegisteredCommandMetadata(
    commandSchemaMetadata,
    registerToolsCommand(root, deps, decodeEscapedPositional)
  );

  root.command("schema", {
    description: "Print input/output schema and metadata for one command path",
    args: z.object({
      commandPath: z.string().min(1),
    }),
    output: z.object({
      ok: z.literal(true),
      command: z.string(),
      description: z.string().optional(),
      schema: z.unknown().nullable(),
      examples: z.array(z.unknown()).optional(),
      metadata: z.object({
        mutating: z.boolean(),
        supportsDryRun: z.boolean(),
        requiresAuth: z.boolean(),
        sideEffects: z.array(z.string()),
      }),
    }),
    async run(context) {
      const commandPath = normalizeCommandPath(decodeEscapedPositional(context.args.commandPath));
      if (!commandPath) {
        throw new Error("Usage: cli schema <command path>");
      }

      const manifest = await readIncurManifest(root, deps);
      const commands = Array.isArray(manifest.commands) ? manifest.commands : [];
      const entry = commands.find(
        (candidate) =>
          typeof candidate.name === "string" &&
          normalizeCommandPath(candidate.name) === commandPath
      );
      if (!entry || typeof entry.name !== "string") {
        throw new Error(
          `Unknown command path "${commandPath}". Run \`cli --llms --format json\` to inspect commands or \`cli --llms-full --format json\` for the full manifest.`
        );
      }

      return {
        ok: true as const,
        command: entry.name,
        ...(typeof entry.description === "string" ? { description: entry.description } : {}),
        schema: entry.schema ?? null,
        ...(Array.isArray(entry.examples) ? { examples: entry.examples } : {}),
        metadata:
          commandSchemaMetadata.get(normalizeCommandPath(entry.name)) ??
          DEFAULT_COMMAND_SCHEMA_METADATA,
      };
    },
  });
  addRegisteredCommandMetadata(
    commandSchemaMetadata,
    [commandMetadata("schema", INTROSPECTION_SCHEMA_METADATA)]
  );

  root.command("send", {
    description: "Execute token transfer",
    args: z.object({
      token: z.string().optional(),
      amount: z.string().optional(),
      to: z.string().optional(),
    }),
    options: z.object({
      network: z.string().optional(),
      decimals: z.string().optional(),
      agent: z.string().optional(),
      idempotencyKey: z.string().optional(),
      dryRun: z.boolean().optional(),
      inputJson: z.string().optional(),
      inputFile: z.string().optional(),
      inputStdin: z.boolean().optional(),
    }),
    output: sendOrTxOutput,
    run(context) {
      return executeSendCommand(
        {
          token: context.args.token,
          amount: context.args.amount,
          to: context.args.to,
          network: context.options.network,
          decimals: context.options.decimals,
          agent: context.options.agent,
          idempotencyKey: context.options.idempotencyKey,
          dryRun: context.options.dryRun,
          inputJson: context.options.inputJson,
          inputFile: context.options.inputFile,
          inputStdin: context.options.inputStdin,
        },
        deps
      );
    },
  });
  addRegisteredCommandMetadata(commandSchemaMetadata, [commandMetadata("send", NETWORK_WRITE_SCHEMA_METADATA)]);

  root.command("tx", {
    description: "Execute raw transaction",
    options: z.object({
      to: z.string().optional(),
      data: z.string().optional(),
      value: z.string().optional(),
      network: z.string().optional(),
      agent: z.string().optional(),
      idempotencyKey: z.string().optional(),
      dryRun: z.boolean().optional(),
      inputJson: z.string().optional(),
      inputFile: z.string().optional(),
      inputStdin: z.boolean().optional(),
    }),
    output: sendOrTxOutput,
    run(context) {
      return executeTxCommand(
        {
          to: context.options.to,
          data: context.options.data,
          value: context.options.value,
          network: context.options.network,
          agent: context.options.agent,
          idempotencyKey: context.options.idempotencyKey,
          dryRun: context.options.dryRun,
          inputJson: context.options.inputJson,
          inputFile: context.options.inputFile,
          inputStdin: context.options.inputStdin,
        },
        deps
      );
    },
  });
  addRegisteredCommandMetadata(commandSchemaMetadata, [commandMetadata("tx", NETWORK_WRITE_SCHEMA_METADATA)]);

  if (!options.mcpMode) {
    root.command("setup", {
      description: "Run setup wizard and bootstrap wallet",
      options: z.object({
        url: z.string().optional(),
        chatApiUrl: z.string().optional(),
        dev: z.boolean().optional(),
        token: z.string().optional(),
        tokenFile: z.string().optional(),
        tokenStdin: z.boolean().optional(),
        agent: z.string().optional(),
        network: z.string().optional(),
        write: z.boolean().optional(),
        showApprovalUrl: z.boolean().optional(),
        walletMode: z.string().optional(),
        walletPrivateKeyStdin: z.boolean().optional(),
        walletPrivateKeyFile: z.string().optional(),
        setupJson: z.boolean().optional(),
        link: z.boolean().optional(),
      }),
      output: setupOutput,
      run(context) {
        return executeSetupCommand(
          {
            url: context.options.url,
            chatApiUrl: context.options.chatApiUrl,
            dev: context.options.dev,
            token: context.options.token,
            tokenFile: context.options.tokenFile,
            tokenStdin: context.options.tokenStdin,
            agent: context.options.agent,
            network: context.options.network,
            write: context.options.write,
            showApprovalUrl: context.options.showApprovalUrl,
            walletMode: context.options.walletMode,
            walletPrivateKeyStdin: context.options.walletPrivateKeyStdin,
            walletPrivateKeyFile: context.options.walletPrivateKeyFile,
            json: context.options.setupJson,
            link: context.options.link,
          },
          deps
        );
      },
    });
    addRegisteredCommandMetadata(
      commandSchemaMetadata,
      [commandMetadata("setup", NETWORK_AND_LOCAL_SETUP_SCHEMA_METADATA)]
    );
  }

  return root;
}
