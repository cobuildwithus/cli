import { Cli, z } from "incur";
import {
  executeConfigSetCommand,
  executeConfigShowCommand,
} from "./commands/config.js";
import { executeDocsCommand } from "./commands/docs.js";
import {
  executeFarcasterPostCommand,
  executeFarcasterSignupCommand,
  executeFarcasterX402InitCommand,
  executeFarcasterX402StatusCommand,
} from "./commands/farcaster.js";
import { executeSendCommand } from "./commands/send.js";
import { executeSetupCommand } from "./commands/setup.js";
import {
  executeToolsCastPreviewCommand,
  executeToolsGetCastCommand,
  executeToolsGetUserCommand,
  executeToolsTreasuryStatsCommand,
} from "./commands/tools.js";
import { executeTxCommand } from "./commands/tx.js";
import { executeWalletCommand } from "./commands/wallet.js";
import type { CliDeps } from "./types.js";

const POSITIONAL_ESCAPE_PREFIX = "__incur_positional__";
const LEADING_GLOBAL_BOOLEAN_FLAGS = new Set([
  "--verbose",
  "--json",
  "--llms",
  "--mcp",
  "--help",
  "-h",
  "--version",
]);
const LEADING_GLOBAL_VALUE_FLAGS = new Set(["--format"]);

export interface CobuildIncurCliOptions {
  mcpMode?: boolean;
}

function encodeEscapedPositional(value: string): string {
  return `${POSITIONAL_ESCAPE_PREFIX}${value}`;
}

function decodeEscapedPositional(value: string): string {
  if (!value.startsWith(POSITIONAL_ESCAPE_PREFIX)) return value;
  return value.slice(POSITIONAL_ESCAPE_PREFIX.length);
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

function normalizeDocsArgv(argv: string[]): string[] {
  if (argv[0] !== "docs") return argv;

  const normalized = ["docs"];
  const queryWords: string[] = [];
  let positionalOnly = false;
  for (let index = 1; index < argv.length; index += 1) {
    const current = argv[index]!;
    if (current === "--") {
      positionalOnly = true;
      continue;
    }

    if (!positionalOnly && current === "--limit") {
      normalized.push(current);
      const next = argv[index + 1];
      if (typeof next === "string") {
        normalized.push(next);
        index += 1;
      }
      continue;
    }

    if (!positionalOnly && current.startsWith("-")) {
      normalized.push(current);
      continue;
    }

    queryWords.push(current);
  }

  if (queryWords.length > 0) {
    normalized.push(encodeEscapedPositional(queryWords.join(" ")));
  }

  return normalized;
}

function normalizeToolsArgv(argv: string[]): string[] {
  if (argv[0] !== "tools") return argv;
  const subcommand = argv[1];
  if (subcommand !== "get-user" && subcommand !== "get-cast") {
    return argv;
  }

  const normalized = ["tools", subcommand];
  const queryWords: string[] = [];
  let positionalOnly = false;

  for (let index = 2; index < argv.length; index += 1) {
    const current = argv[index]!;
    if (current === "--") {
      positionalOnly = true;
      continue;
    }

    if (!positionalOnly && subcommand === "get-cast" && current === "--type") {
      normalized.push(current);
      const next = argv[index + 1];
      if (typeof next === "string") {
        normalized.push(next);
        index += 1;
      }
      continue;
    }

    if (!positionalOnly && subcommand === "get-cast" && current.startsWith("--type=")) {
      normalized.push(current);
      continue;
    }

    if (!positionalOnly && current.startsWith("-")) {
      normalized.push(current);
      continue;
    }

    queryWords.push(current);
  }

  if (queryWords.length > 0) {
    normalized.push(encodeEscapedPositional(queryWords.join(" ")));
  }

  return normalized;
}

function normalizeSetupArgv(argv: string[]): string[] {
  if (argv[0] !== "setup") return argv;
  return argv.map((token) => (token === "--json" ? "--setup-json" : token));
}

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

function splitLeadingGlobalArgv(argv: string[]): { leading: string[]; tail: string[] } {
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

  const commandNormalizedTail = normalizeSetupArgv(
    normalizeToolsArgv(
      normalizeDocsArgv(normalizeFarcasterPostArgv(normalizeFarcasterSignupArgv(normalizedTail)))
    )
  );

  return [...normalizedLeading, ...commandNormalizedTail];
}

export function createCobuildIncurCli(deps: CliDeps, options: CobuildIncurCliOptions = {}): Cli.Cli {
  const docsArgs = z.object({
    query: z.string().optional(),
  });
  const toolNameArgs = z.object({
    value: z.string().optional(),
  });

  const config = Cli.create("config", {
    description: "Read and write local CLI config",
  })
    .command("set", {
      description: "Persist config values",
      options: z.object({
        url: z.string().optional(),
        token: z.string().optional(),
        tokenFile: z.string().optional(),
        tokenStdin: z.boolean().optional(),
        agent: z.string().optional(),
      }),
      run(context) {
        return executeConfigSetCommand(
          {
            url: context.options.url,
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
      run() {
        return executeConfigShowCommand(deps);
      },
    });

  const tools = Cli.create("tools", {
    description: "Execute canonical tool endpoints",
  })
    .command("get-user", {
      description: "Lookup user profile by name",
      args: toolNameArgs,
      run(context) {
        return executeToolsGetUserCommand(
          {
            fname:
              typeof context.args.value === "string"
                ? decodeEscapedPositional(context.args.value)
                : undefined,
          },
          deps
        );
      },
    })
    .command("get-cast", {
      description: "Lookup cast by hash or URL",
      args: toolNameArgs,
      options: z.object({
        type: z.string().optional(),
      }),
      run(context) {
        return executeToolsGetCastCommand(
          {
            identifier:
              typeof context.args.value === "string"
                ? decodeEscapedPositional(context.args.value)
                : undefined,
            type: context.options.type,
          },
          deps
        );
      },
    })
    .command("cast-preview", {
      description: "Generate cast preview payload",
      options: z.object({
        text: z.string().optional(),
        embed: z.array(z.string()).optional(),
        parent: z.string().optional(),
      }),
      run(context) {
        return executeToolsCastPreviewCommand(
          {
            text: context.options.text,
            embed: context.options.embed,
            parent: context.options.parent,
          },
          deps
        );
      },
    })
    .command("get-treasury-stats", {
      description: "Fetch treasury stats snapshot",
      args: z.object({
        extra: z.never().optional(),
      }),
      run() {
        return executeToolsTreasuryStatsCommand(deps);
      },
    });

  const farcasterX402 = Cli.create("x402", {
    description: "Configure and inspect Farcaster x402 payer",
  })
    .command("init", {
      description: "Initialize hosted/local x402 payer mode",
      options: z.object({
        agent: z.string().optional(),
        mode: z.string().optional(),
        privateKeyStdin: z.boolean().optional(),
        privateKeyFile: z.string().optional(),
        prompt: z.boolean().optional(),
      }),
      run(context) {
        return executeFarcasterX402InitCommand(
          {
            agent: context.options.agent,
            mode: context.options.mode,
            privateKeyStdin: context.options.privateKeyStdin,
            privateKeyFile: context.options.privateKeyFile,
            noPrompt: context.options.prompt === false,
          },
          deps
        );
      },
    })
    .command("status", {
      description: "Show x402 payer status for an agent",
      options: z.object({
        agent: z.string().optional(),
      }),
      run(context) {
        return executeFarcasterX402StatusCommand(
          {
            agent: context.options.agent,
          },
          deps
        );
      },
    });

  const farcaster = Cli.create("farcaster", {
    description: "Manage Farcaster signup/posting",
  })
    .command("signup", {
      description: "Create Farcaster account and signer metadata",
      options: z.object({
        agent: z.string().optional(),
        recovery: z.string().optional(),
        extraStorage: z.string().optional(),
        outDir: z.string().optional(),
      }),
      run(context) {
        return executeFarcasterSignupCommand(
          {
            agent: context.options.agent,
            recovery: context.options.recovery,
            extraStorage: context.options.extraStorage,
            outDir: context.options.outDir,
          },
          deps
        );
      },
    })
    .command("post", {
      description: "Submit a cast via Neynar hub",
      options: z.object({
        agent: z.string().optional(),
        text: z.string().optional(),
        fid: z.string().optional(),
        replyTo: z.string().optional(),
        signerFile: z.string().optional(),
        idempotencyKey: z.string().optional(),
        verify: z.string().optional(),
      }),
      run(context) {
        return executeFarcasterPostCommand(
          {
            agent: context.options.agent,
            text: context.options.text,
            fid: context.options.fid,
            replyTo: context.options.replyTo,
            signerFile: context.options.signerFile,
            idempotencyKey: context.options.idempotencyKey,
            verify: context.options.verify,
          },
          deps
        );
      },
    })
    .command(farcasterX402);

  return Cli.create("cli", {
    description: "Cobuild CLI",
    format: "json",
    mcp: {
      command: "npx @cobuild/cli --mcp",
    },
    sync: {
      suggestions: [
        "configure the Cobuild CLI",
        "search docs with cli docs",
        "run cli wallet",
      ],
    },
  })
    .command("setup", {
      description: "Run setup wizard and bootstrap wallet",
      options: z.object({
        url: z.string().optional(),
        dev: z.boolean().optional(),
        token: z.string().optional(),
        tokenFile: z.string().optional(),
        tokenStdin: z.boolean().optional(),
        agent: z.string().optional(),
        network: z.string().optional(),
        setupJson: z.boolean().optional(),
        link: z.boolean().optional(),
      }),
      run(context) {
        if (options.mcpMode) {
          throw new Error("setup is not available in MCP mode");
        }

        return executeSetupCommand(
          {
            url: context.options.url,
            dev: context.options.dev,
            token: context.options.token,
            tokenFile: context.options.tokenFile,
            tokenStdin: context.options.tokenStdin,
            agent: context.options.agent,
            network: context.options.network,
            json: context.options.setupJson,
            link: context.options.link,
          },
          deps
        );
      },
    })
    .command(config)
    .command("wallet", {
      description: "Fetch wallet details",
      options: z.object({
        network: z.string().optional(),
        agent: z.string().optional(),
      }),
      run(context) {
        return executeWalletCommand(
          {
            network: context.options.network,
            agent: context.options.agent,
          },
          deps
        );
      },
    })
    .command("docs", {
      description: "Search Cobuild docs",
      args: docsArgs,
      options: z.object({
        limit: z.string().optional(),
      }),
      run(context) {
        return executeDocsCommand(
          {
            query:
              typeof context.args.query === "string"
                ? decodeEscapedPositional(context.args.query)
                : undefined,
            limit: context.options.limit,
          },
          deps
        );
      },
    })
    .command(tools)
    .command(farcaster)
    .command("send", {
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
      }),
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
          },
          deps
        );
      },
    })
    .command("tx", {
      description: "Execute raw transaction",
      options: z.object({
        to: z.string().optional(),
        data: z.string().optional(),
        value: z.string().optional(),
        network: z.string().optional(),
        agent: z.string().optional(),
        idempotencyKey: z.string().optional(),
      }),
      run(context) {
        return executeTxCommand(
          {
            to: context.options.to,
            data: context.options.data,
            value: context.options.value,
            network: context.options.network,
            agent: context.options.agent,
            idempotencyKey: context.options.idempotencyKey,
          },
          deps
        );
      },
    });
}
