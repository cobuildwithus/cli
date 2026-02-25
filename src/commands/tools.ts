import { parseArgs } from "node:util";
import { printJson } from "../output.js";
import { apiPost } from "../transport.js";
import type { CliDeps } from "../types.js";

const TOOLS_USAGE = `Usage:
  buildbot tools get-user <fname>
  buildbot tools get-cast <identifier> [--type <hash|url>]
  buildbot tools cast-preview --text <text> [--embed <url>] [--parent <value>]
  buildbot tools cobuild-ai-context`;

function inferCastIdentifierType(identifier: string): "hash" | "url" {
  return /^https?:\/\//i.test(identifier) ? "url" : "hash";
}

function parseCastType(type: string | undefined, identifier: string): "hash" | "url" {
  if (!type) return inferCastIdentifierType(identifier);
  if (type === "hash" || type === "url") return type;
  throw new Error("--type must be either 'hash' or 'url'");
}

function parseEmbedUrls(value: string[] | undefined): string[] {
  if (!value) return [];
  return value.map((item) => item.trim()).filter((item) => item.length > 0);
}

async function handleToolsGetUserCommand(args: string[], deps: CliDeps): Promise<void> {
  const fname = args.join(" ").trim();
  if (!fname) throw new Error(TOOLS_USAGE);

  const response = await apiPost(
    deps,
    "/api/buildbot/tools/get-user",
    { fname },
    { endpoint: "chat" }
  );
  printJson(deps, response);
}

async function handleToolsGetCastCommand(args: string[], deps: CliDeps): Promise<void> {
  const parsed = parseArgs({
    options: {
      type: { type: "string" },
    },
    args,
    allowPositionals: true,
    strict: true,
  });

  const identifier = parsed.positionals.join(" ").trim();
  if (!identifier) throw new Error(TOOLS_USAGE);

  const type = parseCastType(parsed.values.type, identifier);
  const response = await apiPost(
    deps,
    "/api/buildbot/tools/get-cast",
    {
      identifier,
      type,
    },
    { endpoint: "chat" }
  );
  printJson(deps, response);
}

async function handleToolsCastPreviewCommand(args: string[], deps: CliDeps): Promise<void> {
  const parsed = parseArgs({
    options: {
      text: { type: "string" },
      embed: { type: "string", multiple: true },
      parent: { type: "string" },
    },
    args,
    allowPositionals: false,
    strict: true,
  });

  const text = parsed.values.text?.trim();
  if (!text) throw new Error(TOOLS_USAGE);

  const embedUrls = parseEmbedUrls(parsed.values.embed);
  if (embedUrls.length > 2) {
    throw new Error("A maximum of two --embed values are allowed.");
  }

  const response = await apiPost(
    deps,
    "/api/buildbot/tools/cast-preview",
    {
      text,
      ...(embedUrls.length ? { embeds: embedUrls.map((url) => ({ url })) } : {}),
      ...(parsed.values.parent ? { parent: parsed.values.parent } : {}),
    },
    { endpoint: "chat" }
  );
  printJson(deps, response);
}

async function handleToolsCobuildAiContextCommand(args: string[], deps: CliDeps): Promise<void> {
  if (args.length > 0) throw new Error(TOOLS_USAGE);

  const response = await apiPost(
    deps,
    "/api/buildbot/tools/cobuild-ai-context",
    {},
    { endpoint: "chat" }
  );
  printJson(deps, response);
}

export async function handleToolsCommand(args: string[], deps: CliDeps): Promise<void> {
  const [subcommand, ...rest] = args;
  if (!subcommand) throw new Error(TOOLS_USAGE);

  if (subcommand === "get-user") {
    await handleToolsGetUserCommand(rest, deps);
    return;
  }

  if (subcommand === "get-cast") {
    await handleToolsGetCastCommand(rest, deps);
    return;
  }

  if (subcommand === "cast-preview") {
    await handleToolsCastPreviewCommand(rest, deps);
    return;
  }

  if (subcommand === "cobuild-ai-context") {
    await handleToolsCobuildAiContextCommand(rest, deps);
    return;
  }

  throw new Error(`Unknown tools subcommand: ${subcommand}`);
}
