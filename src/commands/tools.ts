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
  "getTreasuryStats",
  "treasuryStats",
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

function normalizeKeyedResponse(payload: unknown, key: string): Record<string, unknown> {
  const record = asRecord(payload);
  if (hasOwn(record, key)) {
    if (typeof record.ok === "boolean") {
      return record;
    }
    return { ok: true, [key]: record[key] };
  }
  return { ok: true, [key]: payload };
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

export interface ToolsGetUserOutput extends Record<string, unknown> {
  result: unknown;
  ok?: boolean;
}

export interface ToolsGetCastOutput extends Record<string, unknown> {
  cast: unknown;
  ok?: boolean;
}

export interface ToolsCastPreviewOutput extends Record<string, unknown> {
  cast: unknown;
  ok?: boolean;
}

export interface ToolsTreasuryStatsOutput extends Record<string, unknown> {
  data: unknown;
  ok?: boolean;
}

export async function executeToolsGetUserCommand(
  input: ToolsGetUserInput,
  deps: CliDeps
): Promise<ToolsGetUserOutput> {
  const fname = input.fname?.trim() ?? "";
  if (!fname) throw new Error(TOOLS_USAGE);

  const request = { fname };
  const response = await executeCanonicalToolOnly(deps, {
    canonicalToolNames: GET_USER_CANONICAL_TOOL_NAMES,
    input: request,
  });
  return normalizeKeyedResponse(response, "result") as ToolsGetUserOutput;
}

export async function executeToolsGetCastCommand(
  input: ToolsGetCastInput,
  deps: CliDeps
): Promise<ToolsGetCastOutput> {
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
  return normalizeKeyedResponse(response, "cast") as ToolsGetCastOutput;
}

export async function executeToolsCastPreviewCommand(
  input: ToolsCastPreviewInput,
  deps: CliDeps
): Promise<ToolsCastPreviewOutput> {
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
  return normalizeKeyedResponse(response, "cast") as ToolsCastPreviewOutput;
}

export async function executeToolsTreasuryStatsCommand(
  deps: CliDeps
): Promise<ToolsTreasuryStatsOutput> {
  const response = await executeCanonicalToolOnly(deps, {
    canonicalToolNames: TREASURY_STATS_CANONICAL_TOOL_NAMES,
    input: {},
  });
  return normalizeKeyedResponse(response, "data") as ToolsTreasuryStatsOutput;
}
