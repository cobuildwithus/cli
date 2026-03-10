import type { CliDeps } from "../types.js";
import { readConfig } from "../config.js";
import { parseIntegerOption, resolveAgentKey, resolveNetwork } from "./shared.js";
import { normalizeKeyedRemoteToolResponse } from "./remote-tool.js";
import { executeCanonicalToolOnly } from "./tool-execution.js";

const TOOLS_USAGE = `Usage:
  cli tools get-user <fname>
  cli tools get-cast <identifier> [--type <hash|url>]
  cli tools cast-preview --text <text> [--embed <url>] [--parent <value>]
  cli tools get-treasury-stats
  cli tools get-wallet-balances [--agent <key>] [--network <network>]
  cli tools notifications list [--limit <n>] [--cursor <cursor>] [--unread-only] [--kind <kind>]`;
const GET_USER_CANONICAL_TOOL_NAMES = ["getUser", "get-user"];
const GET_CAST_CANONICAL_TOOL_NAMES = ["getCast", "get-cast"];
const CAST_PREVIEW_CANONICAL_TOOL_NAMES = ["castPreview", "cast-preview"];
const TREASURY_STATS_CANONICAL_TOOL_NAMES = [
  "get-treasury-stats",
  "getTreasuryStats",
  "treasuryStats",
];
const WALLET_BALANCES_CANONICAL_TOOL_NAMES = [
  "get-wallet-balances",
  "getWalletBalances",
  "walletBalances",
];
const WALLET_NOTIFICATIONS_CANONICAL_TOOL_NAMES = [
  "list-wallet-notifications",
  "listWalletNotifications",
  "walletNotifications",
];
const NOTIFICATION_KINDS = ["discussion", "payment", "protocol"] as const;
const NOTIFICATIONS_LIMIT_MIN = 1;
const NOTIFICATIONS_LIMIT_MAX = 50;
const NOTIFICATIONS_CURSOR_MAX_LENGTH = 512;

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
  untrusted: true;
  source: "remote_tool";
  warnings: string[];
}

export interface ToolsGetCastOutput extends Record<string, unknown> {
  cast: unknown;
  ok?: boolean;
  untrusted: true;
  source: "remote_tool";
  warnings: string[];
}

export interface ToolsCastPreviewOutput extends Record<string, unknown> {
  cast: unknown;
  ok?: boolean;
  untrusted: true;
  source: "remote_tool";
  warnings: string[];
}

export interface ToolsTreasuryStatsOutput extends Record<string, unknown> {
  data: unknown;
  ok?: boolean;
  untrusted: true;
  source: "remote_tool";
  warnings: string[];
}

export interface ToolsGetWalletBalancesInput {
  agent?: string;
  network?: string;
}

export interface ToolsGetWalletBalancesOutput extends Record<string, unknown> {
  data: unknown;
  ok?: boolean;
  untrusted: true;
  source: "remote_tool";
  warnings: string[];
}

export interface ToolsNotificationsListInput {
  limit?: string;
  cursor?: string;
  unreadOnly?: boolean;
  kind?: string[];
}

export interface ToolsNotificationsListOutput extends Record<string, unknown> {
  data: unknown;
  ok?: boolean;
  untrusted: true;
  source: "remote_tool";
  warnings: string[];
}

function parseNotificationsLimit(value: string | undefined): number | undefined {
  const parsed = parseIntegerOption(value, "--limit");
  if (parsed === undefined) return undefined;
  if (parsed < NOTIFICATIONS_LIMIT_MIN || parsed > NOTIFICATIONS_LIMIT_MAX) {
    throw new Error(`--limit must be between ${NOTIFICATIONS_LIMIT_MIN} and ${NOTIFICATIONS_LIMIT_MAX}`);
  }
  return parsed;
}

function parseNotificationKinds(value: string[] | undefined): (typeof NOTIFICATION_KINDS)[number][] | undefined {
  if (!value || value.length === 0) return undefined;

  const normalized = value
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (normalized.length === 0) return undefined;

  const unique = new Set<(typeof NOTIFICATION_KINDS)[number]>();
  for (const entry of normalized) {
    if (!NOTIFICATION_KINDS.includes(entry as (typeof NOTIFICATION_KINDS)[number])) {
      throw new Error('--kind must be one of "discussion", "payment", or "protocol"');
    }
    unique.add(entry as (typeof NOTIFICATION_KINDS)[number]);
  }
  return Array.from(unique);
}

function parseNotificationsCursor(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (value.trim().length === 0) {
    throw new Error("--cursor must not be empty");
  }
  if (value.length > NOTIFICATIONS_CURSOR_MAX_LENGTH) {
    throw new Error(`--cursor must not exceed ${NOTIFICATIONS_CURSOR_MAX_LENGTH} characters`);
  }
  return value;
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
  return normalizeKeyedRemoteToolResponse(response, "result") as ToolsGetUserOutput;
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
  return normalizeKeyedRemoteToolResponse(response, "cast") as ToolsGetCastOutput;
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
  return normalizeKeyedRemoteToolResponse(response, "cast") as ToolsCastPreviewOutput;
}

export async function executeToolsTreasuryStatsCommand(
  deps: CliDeps
): Promise<ToolsTreasuryStatsOutput> {
  const response = await executeCanonicalToolOnly(deps, {
    canonicalToolNames: TREASURY_STATS_CANONICAL_TOOL_NAMES,
    input: {},
  });
  return normalizeKeyedRemoteToolResponse(response, "data") as ToolsTreasuryStatsOutput;
}

export async function executeToolsGetWalletBalancesCommand(
  input: ToolsGetWalletBalancesInput,
  deps: CliDeps
): Promise<ToolsGetWalletBalancesOutput> {
  const current = readConfig(deps);
  const request = {
    agentKey: resolveAgentKey(input.agent, current.agent),
    network: resolveNetwork(input.network, deps),
  };

  const response = await executeCanonicalToolOnly(deps, {
    canonicalToolNames: WALLET_BALANCES_CANONICAL_TOOL_NAMES,
    input: request,
  });
  return normalizeKeyedRemoteToolResponse(response, "data") as ToolsGetWalletBalancesOutput;
}

export async function executeToolsNotificationsListCommand(
  input: ToolsNotificationsListInput,
  deps: CliDeps
): Promise<ToolsNotificationsListOutput> {
  const kinds = parseNotificationKinds(input.kind);
  const cursor = parseNotificationsCursor(input.cursor);
  const request = {
    ...(input.limit !== undefined ? { limit: parseNotificationsLimit(input.limit) } : {}),
    ...(cursor !== undefined ? { cursor } : {}),
    ...(input.unreadOnly ? { unreadOnly: true } : {}),
    ...(kinds ? { kinds } : {}),
  };

  const response = await executeCanonicalToolOnly(deps, {
    canonicalToolNames: WALLET_NOTIFICATIONS_CANONICAL_TOOL_NAMES,
    input: request,
  });
  return normalizeKeyedRemoteToolResponse(response, "data") as ToolsNotificationsListOutput;
}
