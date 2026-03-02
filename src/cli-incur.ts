import { Cli, z } from "incur";
import { handleConfigCommand } from "./commands/config.js";
import { handleDocsCommand } from "./commands/docs.js";
import { handleFarcasterCommand } from "./commands/farcaster.js";
import { handleSendCommand } from "./commands/send.js";
import { handleSetupCommand } from "./commands/setup.js";
import { handleToolsCommand } from "./commands/tools.js";
import { handleTxCommand } from "./commands/tx.js";
import { handleWalletCommand } from "./commands/wallet.js";
import type { CliDeps } from "./types.js";

const POSITIONAL_ESCAPE_PREFIX = "__incur_positional__";

function pushOption(argv: string[], flag: string, value: unknown): void {
  if (value === undefined || value === null) return;

  if (Array.isArray(value)) {
    for (const item of value) {
      pushOption(argv, flag, item);
    }
    return;
  }

  if (typeof value === "boolean") {
    if (value) {
      argv.push(`--${flag}`);
    }
    return;
  }

  argv.push(`--${flag}`, String(value));
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

export function preprocessIncurArgv(argv: string[]): string[] {
  return normalizeSetupArgv(
    normalizeToolsArgv(normalizeDocsArgv(normalizeFarcasterPostArgv(normalizeFarcasterSignupArgv(argv))))
  );
}

export function createCobuildIncurCli(deps: CliDeps): Cli.Cli {
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
        const argv = ["set"];
        pushOption(argv, "url", context.options.url);
        pushOption(argv, "token", context.options.token);
        pushOption(argv, "token-file", context.options.tokenFile);
        pushOption(argv, "token-stdin", context.options.tokenStdin);
        pushOption(argv, "agent", context.options.agent);
        return handleConfigCommand(argv, deps);
      },
    })
    .command("show", {
      description: "Print effective config and auth metadata",
      run() {
        return handleConfigCommand(["show"], deps);
      },
    });

  const tools = Cli.create("tools", {
    description: "Execute canonical tool endpoints",
  })
    .command("get-user", {
      description: "Lookup user profile by name",
      args: toolNameArgs,
      run(context) {
        const value = typeof context.args.value === "string" ? decodeEscapedPositional(context.args.value) : undefined;
        return handleToolsCommand(["get-user", ...(value ? [value] : [])], deps);
      },
    })
    .command("get-cast", {
      description: "Lookup cast by hash or URL",
      args: toolNameArgs,
      options: z.object({
        type: z.string().optional(),
      }),
      run(context) {
        const value = typeof context.args.value === "string" ? decodeEscapedPositional(context.args.value) : undefined;
        const argv = ["get-cast"];
        pushOption(argv, "type", context.options.type);
        if (value) {
          if (value.startsWith("-")) {
            argv.push("--");
          }
          argv.push(value);
        }
        return handleToolsCommand(argv, deps);
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
        const argv = ["cast-preview"];
        pushOption(argv, "text", context.options.text);
        pushOption(argv, "embed", context.options.embed);
        pushOption(argv, "parent", context.options.parent);
        return handleToolsCommand(argv, deps);
      },
    })
    .command("get-treasury-stats", {
      description: "Fetch treasury stats snapshot",
      args: z.object({
        extra: z.string().optional(),
      }),
      run(context) {
        const extraArgs = typeof context.args.extra === "string" ? [context.args.extra] : [];
        return handleToolsCommand(["get-treasury-stats", ...extraArgs], deps);
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
        const argv = ["x402", "init"];
        pushOption(argv, "agent", context.options.agent);
        pushOption(argv, "mode", context.options.mode);
        pushOption(argv, "private-key-stdin", context.options.privateKeyStdin);
        pushOption(argv, "private-key-file", context.options.privateKeyFile);
        if (context.options.prompt === false) {
          argv.push("--no-prompt");
        }
        return handleFarcasterCommand(argv, deps);
      },
    })
    .command("status", {
      description: "Show x402 payer status for an agent",
      options: z.object({
        agent: z.string().optional(),
      }),
      run(context) {
        const argv = ["x402", "status"];
        pushOption(argv, "agent", context.options.agent);
        return handleFarcasterCommand(argv, deps);
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
        const argv = ["signup"];
        pushOption(argv, "agent", context.options.agent);
        pushOption(argv, "recovery", context.options.recovery);
        pushOption(argv, "extra-storage", context.options.extraStorage);
        pushOption(argv, "out-dir", context.options.outDir);
        return handleFarcasterCommand(argv, deps);
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
        const argv = ["post"];
        pushOption(argv, "agent", context.options.agent);
        pushOption(argv, "text", context.options.text);
        pushOption(argv, "fid", context.options.fid);
        pushOption(argv, "reply-to", context.options.replyTo);
        pushOption(argv, "signer-file", context.options.signerFile);
        pushOption(argv, "idempotency-key", context.options.idempotencyKey);
        pushOption(argv, "verify", context.options.verify);
        return handleFarcasterCommand(argv, deps);
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
        const argv: string[] = [];
        pushOption(argv, "url", context.options.url);
        pushOption(argv, "dev", context.options.dev);
        pushOption(argv, "token", context.options.token);
        pushOption(argv, "token-file", context.options.tokenFile);
        pushOption(argv, "token-stdin", context.options.tokenStdin);
        pushOption(argv, "agent", context.options.agent);
        pushOption(argv, "network", context.options.network);
        pushOption(argv, "json", context.options.setupJson);
        pushOption(argv, "link", context.options.link);
        return handleSetupCommand(argv, deps);
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
        const argv: string[] = [];
        pushOption(argv, "network", context.options.network);
        pushOption(argv, "agent", context.options.agent);
        return handleWalletCommand(argv, deps);
      },
    })
    .command("docs", {
      description: "Search Cobuild docs",
      args: docsArgs,
      options: z.object({
        limit: z.string().optional(),
      }),
      run(context) {
        const query = typeof context.args.query === "string" ? decodeEscapedPositional(context.args.query) : undefined;
        const argv: string[] = [];
        pushOption(argv, "limit", context.options.limit);
        if (typeof query === "string" && query.startsWith("-")) {
          argv.push("--");
        }
        if (typeof query === "string" && query.length > 0) {
          argv.push(query);
        }
        return handleDocsCommand(argv, deps);
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
        const argv = [context.args.token, context.args.amount, context.args.to].filter(
          (value): value is string => typeof value === "string"
        );
        pushOption(argv, "network", context.options.network);
        pushOption(argv, "decimals", context.options.decimals);
        pushOption(argv, "agent", context.options.agent);
        pushOption(argv, "idempotency-key", context.options.idempotencyKey);
        return handleSendCommand(argv, deps);
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
        const argv: string[] = [];
        pushOption(argv, "to", context.options.to);
        pushOption(argv, "data", context.options.data);
        pushOption(argv, "value", context.options.value);
        pushOption(argv, "network", context.options.network);
        pushOption(argv, "agent", context.options.agent);
        pushOption(argv, "idempotency-key", context.options.idempotencyKey);
        return handleTxCommand(argv, deps);
      },
    });
}
