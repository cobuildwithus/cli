import { parseArgs } from "node:util";
import { printJson } from "../output.js";
import { asRecord } from "../transport.js";
import type { CliDeps } from "../types.js";
import { parseIntegerOption } from "./shared.js";
import { executeToolWithLegacyFallback } from "./tool-execution.js";

const DOCS_USAGE = "Usage: cli docs <query> [--limit <n>]";
const DOCS_LIMIT_MIN = 1;
const DOCS_LIMIT_MAX = 20;
const DOCS_CANONICAL_TOOL_NAMES = ["docsSearch", "docs_search", "file_search"];

function normalizeDocsResponse(query: string, payload: unknown): Record<string, unknown> {
  if (payload === null || payload === undefined) {
    return { query, count: 0, results: [] };
  }

  if (Array.isArray(payload)) {
    return { query, count: payload.length, results: payload };
  }

  const record = asRecord(payload);
  if (typeof record.query === "string" && typeof record.count === "number" && Array.isArray(record.results)) {
    return record;
  }

  if (Array.isArray(record.results)) {
    return {
      query: typeof record.query === "string" ? record.query : query,
      count: typeof record.count === "number" ? record.count : record.results.length,
      results: record.results,
    };
  }

  if (Array.isArray(record.data)) {
    return { query, count: record.data.length, results: record.data };
  }

  if (Array.isArray(record.output)) {
    return { query, count: record.output.length, results: record.output };
  }

  return { query, count: 1, results: [payload] };
}

export async function handleDocsCommand(args: string[], deps: CliDeps): Promise<void> {
  const parsed = parseArgs({
    options: {
      limit: { type: "string" },
    },
    args,
    allowPositionals: true,
    strict: true,
  });

  const query = parsed.positionals.join(" ").trim();
  if (!query) {
    throw new Error(DOCS_USAGE);
  }

  const limit = parseIntegerOption(parsed.values.limit, "--limit");
  if (limit !== undefined && (limit < DOCS_LIMIT_MIN || limit > DOCS_LIMIT_MAX)) {
    throw new Error(`--limit must be between ${DOCS_LIMIT_MIN} and ${DOCS_LIMIT_MAX}`);
  }

  const request = {
    query,
    ...(limit !== undefined ? { limit } : {}),
  };

  const response = await executeToolWithLegacyFallback(deps, {
    canonicalToolNames: DOCS_CANONICAL_TOOL_NAMES,
    input: request,
    legacyPath: "/api/docs/search",
    legacyBody: request,
  });

  printJson(deps, normalizeDocsResponse(query, response));
}
