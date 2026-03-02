import { parseArgs } from "node:util";
import { printJson } from "../output.js";
import { asRecord } from "../transport.js";
import type { CliDeps } from "../types.js";
import { executeToolWithLegacyFallback } from "./tool-execution.js";

const TOOLS_USAGE = `Usage:
  cli tools get-user <fname>
  cli tools get-cast <identifier> [--type <hash|url>]
  cli tools cast-preview --text <text> [--embed <url>] [--parent <value>]
  cli tools cobuild-ai-context`;
const GET_USER_CANONICAL_TOOL_NAMES = ["getUser", "get-user"];
const GET_CAST_CANONICAL_TOOL_NAMES = ["getCast", "get-cast"];
const CAST_PREVIEW_CANONICAL_TOOL_NAMES = ["castPreview", "cast-preview"];
const COBUILD_CONTEXT_CANONICAL_TOOL_NAMES = [
  "getCobuildAiContext",
  "cobuild-ai-context",
  "get_cobuild_ai_context",
];

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

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function normalizeGetUserResponse(payload: unknown): Record<string, unknown> {
  const record = asRecord(payload);
  if (hasOwn(record, "result")) {
    if (typeof record.ok === "boolean") {
      return record;
    }
    return { ok: true, result: record.result };
  }
  return { ok: true, result: payload };
}

function normalizeGetCastResponse(payload: unknown): Record<string, unknown> {
  const record = asRecord(payload);
  if (hasOwn(record, "cast")) {
    if (typeof record.ok === "boolean") {
      return record;
    }
    return { ok: true, cast: record.cast };
  }
  return { ok: true, cast: payload };
}

function normalizeCastPreviewResponse(payload: unknown): Record<string, unknown> {
  const record = asRecord(payload);
  if (hasOwn(record, "cast")) {
    if (typeof record.ok === "boolean") {
      return record;
    }
    return { ok: true, cast: record.cast };
  }
  return { ok: true, cast: payload };
}

function normalizeCobuildAiContextResponse(payload: unknown): Record<string, unknown> {
  const record = asRecord(payload);
  if (hasOwn(record, "data")) {
    if (typeof record.ok === "boolean") {
      return record;
    }
    return { ok: true, data: record.data };
  }
  return { ok: true, data: payload };
}

async function handleToolsGetUserCommand(args: string[], deps: CliDeps): Promise<void> {
  const fname = args.join(" ").trim();
  if (!fname) throw new Error(TOOLS_USAGE);

  const request = { fname };
  const response = await executeToolWithLegacyFallback(deps, {
    canonicalToolNames: GET_USER_CANONICAL_TOOL_NAMES,
    input: request,
    legacyPath: "/api/buildbot/tools/get-user",
    legacyBody: request,
  });
  printJson(deps, normalizeGetUserResponse(response));
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
  const request = {
    identifier,
    type,
  };
  const response = await executeToolWithLegacyFallback(deps, {
    canonicalToolNames: GET_CAST_CANONICAL_TOOL_NAMES,
    input: request,
    legacyPath: "/api/buildbot/tools/get-cast",
    legacyBody: request,
  });
  printJson(deps, normalizeGetCastResponse(response));
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

  const request = {
    text,
    ...(embedUrls.length ? { embeds: embedUrls.map((url) => ({ url })) } : {}),
    ...(parsed.values.parent ? { parent: parsed.values.parent } : {}),
  };
  const response = await executeToolWithLegacyFallback(deps, {
    canonicalToolNames: CAST_PREVIEW_CANONICAL_TOOL_NAMES,
    input: request,
    legacyPath: "/api/buildbot/tools/cast-preview",
    legacyBody: request,
  });
  printJson(deps, normalizeCastPreviewResponse(response));
}

async function handleToolsCobuildAiContextCommand(args: string[], deps: CliDeps): Promise<void> {
  if (args.length > 0) throw new Error(TOOLS_USAGE);

  const response = await executeToolWithLegacyFallback(deps, {
    canonicalToolNames: COBUILD_CONTEXT_CANONICAL_TOOL_NAMES,
    input: {},
    legacyPath: "/api/buildbot/tools/cobuild-ai-context",
    legacyBody: {},
  });
  printJson(deps, normalizeCobuildAiContextResponse(response));
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
