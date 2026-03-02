import { parseArgs } from "node:util";
import { printJson } from "../output.js";
import { asRecord } from "../transport.js";
import type { CliDeps } from "../types.js";
import { executeCanonicalToolOnly } from "./tool-execution.js";

const TOOLS_USAGE = `Usage:
  cli tools get-user <fname>
  cli tools get-cast <identifier> [--type <hash|url>]
  cli tools cast-preview --text <text> [--embed <url>] [--parent <value>]
  cli tools get-treasury-stats`;
const GET_USER_CANONICAL_TOOL_NAMES = ["getUser", "get-user"];
const GET_CAST_CANONICAL_TOOL_NAMES = ["getCast", "get-cast"];
const CAST_PREVIEW_CANONICAL_TOOL_NAMES = ["castPreview", "cast-preview"];
const TREASURY_STATS_CANONICAL_TOOL_NAMES = [
  "get-treasury-stats",
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

function normalizeTreasuryStatsResponse(payload: unknown): Record<string, unknown> {
  const record = asRecord(payload);
  if (hasOwn(record, "data")) {
    if (typeof record.ok === "boolean") {
      return record;
    }
    return { ok: true, data: record.data };
  }
  return { ok: true, data: payload };
}

export interface ToolsGetUserInput {
  fname?: string;
}

export interface ToolsGetCastInput {
  identifier?: string;
  type?: string;
}

export interface ToolsCastPreviewInput {
  text?: string;
  embed?: string[];
  parent?: string;
}

export async function executeToolsGetUserCommand(
  input: ToolsGetUserInput,
  deps: CliDeps
): Promise<Record<string, unknown>> {
  const fname = input.fname?.trim() ?? "";
  if (!fname) throw new Error(TOOLS_USAGE);

  const request = { fname };
  const response = await executeCanonicalToolOnly(deps, {
    canonicalToolNames: GET_USER_CANONICAL_TOOL_NAMES,
    input: request,
  });
  return normalizeGetUserResponse(response);
}

export async function executeToolsGetCastCommand(
  input: ToolsGetCastInput,
  deps: CliDeps
): Promise<Record<string, unknown>> {
  const identifier = input.identifier?.trim() ?? "";
  if (!identifier) throw new Error(TOOLS_USAGE);

  const type = parseCastType(input.type, identifier);
  const request = {
    identifier,
    type,
  };
  const response = await executeCanonicalToolOnly(deps, {
    canonicalToolNames: GET_CAST_CANONICAL_TOOL_NAMES,
    input: request,
  });
  return normalizeGetCastResponse(response);
}

export async function executeToolsCastPreviewCommand(
  input: ToolsCastPreviewInput,
  deps: CliDeps
): Promise<Record<string, unknown>> {
  const text = input.text?.trim();
  if (!text) throw new Error(TOOLS_USAGE);

  const embedUrls = parseEmbedUrls(input.embed);
  if (embedUrls.length > 2) {
    throw new Error("A maximum of two --embed values are allowed.");
  }

  const request = {
    text,
    ...(embedUrls.length ? { embeds: embedUrls.map((url) => ({ url })) } : {}),
    ...(input.parent ? { parent: input.parent } : {}),
  };
  const response = await executeCanonicalToolOnly(deps, {
    canonicalToolNames: CAST_PREVIEW_CANONICAL_TOOL_NAMES,
    input: request,
  });
  return normalizeCastPreviewResponse(response);
}

export async function executeToolsTreasuryStatsCommand(deps: CliDeps): Promise<Record<string, unknown>> {
  const response = await executeCanonicalToolOnly(deps, {
    canonicalToolNames: TREASURY_STATS_CANONICAL_TOOL_NAMES,
    input: {},
  });
  return normalizeTreasuryStatsResponse(response);
}

async function handleToolsGetUserCommand(args: string[], deps: CliDeps): Promise<void> {
  const output = await executeToolsGetUserCommand(
    {
      fname: args.join(" "),
    },
    deps
  );
  printJson(deps, output);
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

  const output = await executeToolsGetCastCommand(
    {
      identifier: parsed.positionals.join(" "),
      type: parsed.values.type,
    },
    deps
  );
  printJson(deps, output);
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

  const output = await executeToolsCastPreviewCommand(
    {
      text: parsed.values.text,
      embed: parsed.values.embed,
      parent: parsed.values.parent,
    },
    deps
  );
  printJson(deps, output);
}

async function handleToolsTreasuryStatsCommand(args: string[], deps: CliDeps): Promise<void> {
  if (args.length > 0) throw new Error(TOOLS_USAGE);

  const output = await executeToolsTreasuryStatsCommand(deps);
  printJson(deps, output);
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

  if (subcommand === "get-treasury-stats") {
    await handleToolsTreasuryStatsCommand(rest, deps);
    return;
  }

  throw new Error(`Unknown tools subcommand: ${subcommand}`);
}
