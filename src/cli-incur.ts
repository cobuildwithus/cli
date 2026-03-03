import { Cli, z } from "incur";
import {
  executeConfigSetCommand,
  executeConfigShowCommand,
} from "./commands/config.js";
import { executeDocsCommand } from "./commands/docs.js";
import {
  executeFarcasterPostCommand,
  executeFarcasterSignupCommand,
} from "./commands/farcaster.js";
import { executeSendCommand } from "./commands/send.js";
import { executeSetupCommand } from "./commands/setup.js";
import {
  executeToolsCastPreviewCommand,
  executeToolsGetCastCommand,
  executeToolsGetWalletBalancesCommand,
  executeToolsGetUserCommand,
  executeToolsTreasuryStatsCommand,
} from "./commands/tools.js";
import { executeTxCommand } from "./commands/tx.js";
import {
  executeWalletCommand,
  executeWalletPayerInitCommand,
  executeWalletPayerStatusCommand,
} from "./commands/wallet.js";
import type { CliDeps } from "./types.js";

const POSITIONAL_ESCAPE_PREFIX = "__incur_positional_b64__";
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
      normalizeDocsArgv(
        normalizeFarcasterPostArgv(normalizeFarcasterSignupArgv(normalizedTail))
      )
    )
  );

  return [...normalizedLeading, ...commandNormalizedTail];
}

export function createCobuildIncurCli(deps: CliDeps, options: CobuildIncurCliOptions = {}): Cli.Cli {
  const docsArgs = z.object({
    query: z.string().min(1),
  });
  const docsOptions = z.object({
    limit: z.coerce.number().int().min(1).max(20).optional(),
  });
  const toolNameArgs = z.object({
    value: z.string().min(1),
  });
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
    payer: z
      .object({
        mode: z.enum(["hosted", "local"]),
        payerAddress: z.string().nullable(),
        network: z.string(),
        token: z.string(),
        costPerPaidCallMicroUsdc: z.string(),
      })
      .optional(),
    next: z.array(z.string()),
  });
  const docsOutput = z.object({
    query: z.string(),
    count: z.number(),
    results: z.array(z.unknown()),
  });
  const getUserOutput = z.object({
    result: z.unknown(),
    ok: z.boolean().optional(),
  }).passthrough();
  const getCastOutput = z.object({
    cast: z.unknown(),
    ok: z.boolean().optional(),
  }).passthrough();
  const castPreviewOutput = z.object({
    cast: z.unknown(),
    ok: z.boolean().optional(),
  }).passthrough();
  const treasuryStatsOutput = z.object({
    data: z.unknown(),
    ok: z.boolean().optional(),
  }).passthrough();
  const walletBalancesOutput = z.object({
    data: z.unknown(),
    ok: z.boolean().optional(),
  }).passthrough();
  const walletPayerOutput = z.object({
    mode: z.enum(["hosted", "local"]),
    payerAddress: z.string().nullable(),
    network: z.string(),
    token: z.string(),
    costPerPaidCallMicroUsdc: z.string(),
  });
  const walletOutput = z
    .object({
      ok: z.boolean().optional(),
      address: z.string().optional(),
      agentKey: z.string().optional(),
      payer: walletPayerOutput.optional(),
    })
    .passthrough();
  const farcasterSignerOutput = z.object({
    publicKey: z.string(),
    saved: z.boolean(),
    file: z.string(),
  });
  const farcasterSignupOutput = z
    .object({
      ok: z.boolean().optional(),
      result: z.unknown().optional(),
      signer: farcasterSignerOutput.optional(),
    })
    .passthrough();
  const farcasterPostOutput = z
    .object({
      ok: z.boolean().optional(),
      replayed: z.boolean().optional(),
      resumedPending: z.boolean().optional(),
      idempotencyKey: z.string(),
      result: z.object({
        fid: z.number().optional(),
        text: z.string().optional(),
        parentAuthorFid: z.number().optional(),
        parentHashHex: z.string().optional(),
        castHashHex: z.string().optional(),
        hubResponseStatus: z.number().optional(),
        hubResponse: z.unknown().optional(),
        payerAddress: z.string().nullable().optional(),
        payerAgentKey: z.string().optional(),
        x402Token: z.string().nullable().optional(),
        x402Amount: z.string().nullable().optional(),
        x402Network: z.string().nullable().optional(),
        verification: z
          .object({
            enabled: z.literal(true),
            included: z.literal(true),
            attempts: z.number(),
          })
          .optional(),
      }).passthrough(),
    })
    .passthrough();
  const sendOrTxOutput = z.object({
    idempotencyKey: z.string(),
  }).passthrough();

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

  const tools = Cli.create("tools", {
    description: "Execute canonical tool endpoints",
  })
    .command("get-user", {
      description: "Lookup user profile by name",
      args: toolNameArgs,
      output: getUserOutput,
      run(context) {
        return executeToolsGetUserCommand(
          {
            fname: decodeEscapedPositional(context.args.value),
          },
          deps
        );
      },
    })
    .command("get-cast", {
      description: "Lookup cast by hash or URL",
      args: toolNameArgs,
      options: z.object({
        type: z.enum(["hash", "url"]).optional(),
      }),
      output: getCastOutput,
      run(context) {
        return executeToolsGetCastCommand(
          {
            identifier: decodeEscapedPositional(context.args.value),
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
      output: castPreviewOutput,
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
      output: treasuryStatsOutput,
      run() {
        return executeToolsTreasuryStatsCommand(deps);
      },
    })
    .command("get-wallet-balances", {
      description: "Fetch wallet ETH and USDC balances",
      args: z.object({
        extra: z.never().optional(),
      }),
      options: z.object({
        agent: z.string().optional(),
        network: z.string().optional(),
      }),
      output: walletBalancesOutput,
      run(context) {
        return executeToolsGetWalletBalancesCommand(
          {
            agent: context.options.agent,
            network: context.options.network,
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
      output: farcasterSignupOutput,
      run(context) {
        return executeFarcasterSignupCommand(
          {
            agent: context.options.agent,
            recovery: context.options.recovery,
            extraStorage: context.options.extraStorage,
            outDir: context.options.outDir,
          },
          deps
        ) as Promise<z.infer<typeof farcasterSignupOutput>>;
      },
    })
    .command("post", {
      description: "Submit a cast via Neynar hub",
      options: z.object({
        agent: z.string().optional(),
        text: z.string().optional(),
        fid: z.coerce.number().int().positive().optional(),
        replyTo: z.string().optional(),
        signerFile: z.string().optional(),
        idempotencyKey: z.string().optional(),
        verify: z.enum(["none", "once", "poll"]).optional(),
      }),
      output: farcasterPostOutput,
      run(context) {
        return executeFarcasterPostCommand(
          {
            agent: context.options.agent,
            text: context.options.text,
            fid: context.options.fid !== undefined ? String(context.options.fid) : undefined,
            replyTo: context.options.replyTo,
            signerFile: context.options.signerFile,
            idempotencyKey: context.options.idempotencyKey,
            verify: context.options.verify,
          },
          deps
        ) as Promise<z.infer<typeof farcasterPostOutput>>;
      },
    });

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
        "run cli wallet",
      ],
    },
  })
    .command(config)
    .command("wallet", {
      description: "Fetch wallet details and manage payer configuration",
      args: z.object({
        namespace: z.string().optional(),
        action: z.string().optional(),
      }),
      options: z.object({
        network: z.string().optional(),
        agent: z.string().optional(),
        mode: z.string().optional(),
        privateKeyStdin: z.boolean().optional(),
        privateKeyFile: z.string().optional(),
        prompt: z.boolean().optional(),
      }),
      output: walletOutput,
      run(context) {
        const namespace = context.args.namespace?.trim().toLowerCase();
        const action = context.args.action?.trim().toLowerCase();

        if (namespace === undefined && action === undefined) {
          return executeWalletCommand(
            {
              network: context.options.network,
              agent: context.options.agent,
            },
            deps
          ) as Promise<z.infer<typeof walletOutput>>;
        }

        if (namespace === "payer" && action === "init") {
          return executeWalletPayerInitCommand(
            {
              agent: context.options.agent,
              mode: context.options.mode,
              privateKeyStdin: context.options.privateKeyStdin,
              privateKeyFile: context.options.privateKeyFile,
              noPrompt: context.options.prompt === false,
            },
            deps
          ) as Promise<z.infer<typeof walletOutput>>;
        }

        if (namespace === "payer" && action === "status") {
          return executeWalletPayerStatusCommand(
            {
              agent: context.options.agent,
            },
            deps
          ) as Promise<z.infer<typeof walletOutput>>;
        }

        throw new Error(
          "Usage:\n  cli wallet [--network <network>] [--agent <key>]\n  cli wallet payer init [--agent <key>] [--mode hosted|local-generate|local-key] [--private-key-stdin|--private-key-file <path>] [--no-prompt]\n  cli wallet payer status [--agent <key>]"
        );
      },
    })
    .command("docs", {
      description: "Search Cobuild docs",
      args: docsArgs,
      options: docsOptions,
      output: docsOutput,
      run(context) {
        return executeDocsCommand(
          {
            query: decodeEscapedPositional(context.args.query),
            limit: context.options.limit !== undefined ? String(context.options.limit) : undefined,
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
        token: z.string().min(1),
        amount: z.string().min(1),
        to: z.string().min(1),
      }),
      options: z.object({
        network: z.string().optional(),
        decimals: z.string().optional(),
        agent: z.string().optional(),
        idempotencyKey: z.string().optional(),
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
          },
          deps
        );
      },
    })
    .command("tx", {
      description: "Execute raw transaction",
      options: z.object({
        to: z.string().min(1),
        data: z.string().min(1),
        value: z.string().optional(),
        network: z.string().optional(),
        agent: z.string().optional(),
        idempotencyKey: z.string().optional(),
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
          },
          deps
        );
      },
    });

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
        payerMode: z.string().optional(),
        payerPrivateKeyStdin: z.boolean().optional(),
        payerPrivateKeyFile: z.string().optional(),
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
            payerMode: context.options.payerMode,
            payerPrivateKeyStdin: context.options.payerPrivateKeyStdin,
            payerPrivateKeyFile: context.options.payerPrivateKeyFile,
            json: context.options.setupJson,
            link: context.options.link,
          },
          deps
        );
      },
    });
  }

  return root;
}
