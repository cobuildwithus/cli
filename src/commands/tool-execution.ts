import { ApiRequestError, apiGet, apiPost, asRecord } from "../transport.js";
import type { CliDeps } from "../types.js";

const CANONICAL_TOOLS_DISCOVERY_PATH = "/v1/tools";
const CANONICAL_TOOL_EXECUTIONS_PATH = "/v1/tool-executions";
const FALLBACK_STATUS_CODES = new Set([400, 401, 403, 404, 405, 415, 422, 501]);

interface ExecuteToolWithFallbackOptions {
  canonicalToolNames: string[];
  input: Record<string, unknown>;
  legacyPath: string;
  legacyBody: Record<string, unknown>;
}

function normalizeToolName(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractCatalogToolName(value: unknown): string | null {
  if (!isRecord(value)) return null;
  if (typeof value.name === "string" && value.name.trim().length > 0) return value.name;
  if (typeof value.toolName === "string" && value.toolName.trim().length > 0) return value.toolName;
  if (typeof value.id === "string" && value.id.trim().length > 0) return value.id;
  return null;
}

function extractToolCatalogEntries(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;

  const record = asRecord(payload);
  if (Array.isArray(record.tools)) return record.tools;
  if (Array.isArray(record.data)) return record.data;
  if (Array.isArray(record.results)) return record.results;
  return [];
}

function prioritizedCanonicalToolNames(
  configuredCandidates: string[],
  discoveredCatalog: unknown
): string[] {
  const normalizedCandidateMap = new Map<string, string>();
  for (const candidate of configuredCandidates) {
    const trimmed = candidate.trim();
    if (!trimmed) continue;
    const key = normalizeToolName(trimmed);
    if (!normalizedCandidateMap.has(key)) {
      normalizedCandidateMap.set(key, trimmed);
    }
  }

  const discovered = extractToolCatalogEntries(discoveredCatalog)
    .map(extractCatalogToolName)
    .filter((name): name is string => typeof name === "string")
    .reduce<string[]>((acc, name) => {
      const key = normalizeToolName(name);
      if (normalizedCandidateMap.has(key)) {
        acc.push(name);
      }
      return acc;
    }, []);

  const ordered = [...discovered, ...normalizedCandidateMap.values()];
  const unique = new Set<string>();
  const deduped: string[] = [];
  for (const candidate of ordered) {
    const key = normalizeToolName(candidate);
    if (unique.has(key)) continue;
    unique.add(key);
    deduped.push(candidate);
  }
  return deduped;
}

function extractExecutionValue(record: Record<string, unknown>): unknown | undefined {
  for (const key of ["result", "output", "data", "value", "toolResult"]) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      return record[key];
    }
  }
  return undefined;
}

function extractCanonicalExecutionResult(payload: unknown): unknown {
  if (Array.isArray(payload)) return payload;

  const record = asRecord(payload);
  const direct = extractExecutionValue(record);
  if (direct !== undefined) {
    return direct;
  }

  for (const nestedKey of ["execution", "toolExecution"]) {
    const nested = record[nestedKey];
    if (!isRecord(nested)) continue;
    const nestedValue = extractExecutionValue(nested);
    if (nestedValue !== undefined) {
      return nestedValue;
    }
  }

  return payload;
}

export function shouldFallbackToLegacyToolRoute(error: unknown): boolean {
  if (!(error instanceof ApiRequestError)) {
    return false;
  }
  return FALLBACK_STATUS_CODES.has(error.status);
}

function buildCanonicalExecutionBody(toolName: string, input: Record<string, unknown>): Record<string, unknown> {
  return {
    toolName,
    name: toolName,
    input,
    arguments: input,
  };
}

async function discoverCanonicalToolCatalog(
  deps: Pick<CliDeps, "fetch" | "fs" | "homedir">
): Promise<unknown | null> {
  try {
    return await apiGet(deps, CANONICAL_TOOLS_DISCOVERY_PATH);
  } catch (error) {
    if (shouldFallbackToLegacyToolRoute(error)) {
      return null;
    }
    throw error;
  }
}

async function executeCanonicalTool(
  deps: Pick<CliDeps, "fetch" | "fs" | "homedir">,
  toolName: string,
  input: Record<string, unknown>
): Promise<unknown> {
  const payload = await apiPost(
    deps,
    CANONICAL_TOOL_EXECUTIONS_PATH,
    buildCanonicalExecutionBody(toolName, input)
  );
  return extractCanonicalExecutionResult(payload);
}

export async function executeToolWithLegacyFallback(
  deps: Pick<CliDeps, "fetch" | "fs" | "homedir">,
  options: ExecuteToolWithFallbackOptions
): Promise<unknown> {
  const configured = options.canonicalToolNames.map((name) => name.trim()).filter(Boolean);
  if (configured.length === 0) {
    throw new Error("At least one canonical tool name must be configured.");
  }

  const discoveredCatalog = await discoverCanonicalToolCatalog(deps);
  const candidates = prioritizedCanonicalToolNames(configured, discoveredCatalog);

  for (const candidate of candidates) {
    try {
      return await executeCanonicalTool(deps, candidate, options.input);
    } catch (error) {
      if (!shouldFallbackToLegacyToolRoute(error)) {
        throw error;
      }
    }
  }

  return apiPost(deps, options.legacyPath, options.legacyBody);
}
