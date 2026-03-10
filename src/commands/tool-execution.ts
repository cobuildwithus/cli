import {
  parseCliToolExecutionSuccessResponse,
  parseCliToolsListResponse,
  serializeCliToolExecutionRequest,
  type CliToolsListResponse,
} from "@cobuild/wire";
import { ApiRequestError, apiGet, apiPost } from "../transport.js";
import type { CliDeps } from "../types.js";

const CANONICAL_TOOLS_DISCOVERY_PATH = "/v1/tools";
const CANONICAL_TOOL_EXECUTIONS_PATH = "/v1/tool-executions";
const RETRYABLE_CANONICAL_STATUS_CODES = new Set([400, 404, 405, 422]);
const CANONICAL_ROUTE_CUTOVER_GUIDANCE =
  "Canonical /v1 tool routes are unavailable. Configure Chat API routing with --chat-api-url (setup/config set) or ensure /v1/* is rewritten to Chat API.";

interface ExecuteCanonicalToolOptions {
  canonicalToolNames: string[];
  input: Record<string, unknown>;
}

interface CanonicalDiscoveryResult {
  catalog: CliToolsListResponse | null;
  routeUnavailable: boolean;
}

function normalizeToolName(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

function prioritizedCanonicalToolNames(
  configuredCandidates: string[],
  discoveredCatalog: CliToolsListResponse | null
): string[] {
  const normalizedCandidateKeys = new Set<string>();
  const configured = [] as string[];
  const configuredExactSet = new Set<string>();
  for (const candidate of configuredCandidates) {
    const trimmed = candidate.trim();
    if (!trimmed) continue;
    normalizedCandidateKeys.add(normalizeToolName(trimmed));
    if (!configuredExactSet.has(trimmed)) {
      configured.push(trimmed);
      configuredExactSet.add(trimmed);
    }
  }

  const discoveredExactSet = new Set<string>();
  const discovered = (discoveredCatalog?.tools ?? [])
    .map((tool) => tool.name)
    .reduce<string[]>((acc, name) => {
      const key = normalizeToolName(name);
      if (normalizedCandidateKeys.has(key) && !discoveredExactSet.has(name)) {
        acc.push(name);
        discoveredExactSet.add(name);
      }
      return acc;
    }, []);

  const ordered = [...discovered, ...configured];
  const unique = new Set<string>();
  const deduped: string[] = [];
  for (const candidate of ordered) {
    if (unique.has(candidate)) continue;
    unique.add(candidate);
    deduped.push(candidate);
  }
  return deduped;
}

function extractCanonicalExecutionResult(payload: unknown, toolName: string): unknown {
  const parsed = parseCliToolExecutionSuccessResponse(payload);
  if (parsed.name !== toolName) {
    throw new Error(
      `Tool execution response name mismatch: expected "${toolName}", got "${parsed.name}".`
    );
  }
  return parsed.output;
}

function shouldRetryCanonicalToolCandidate(error: unknown): error is ApiRequestError {
  if (!(error instanceof ApiRequestError)) {
    return false;
  }
  return RETRYABLE_CANONICAL_STATUS_CODES.has(error.status);
}

function isCanonicalRouteNotFound(error: unknown): error is ApiRequestError {
  return error instanceof ApiRequestError && error.status === 404;
}

function isLikelyToolNameMismatchNotFoundDetail(detail: string | null): boolean {
  if (!detail) return false;
  const normalized = detail.toLowerCase();
  if (
    normalized.includes("/v1/tool-executions") ||
    normalized.includes("/v1/tools") ||
    normalized.includes("cannot post") ||
    normalized.includes("cannot get") ||
    normalized.includes("route")
  ) {
    return false;
  }
  return (
    normalized === "tool not found" ||
    normalized.startsWith("tool not found:") ||
    normalized.includes("unknown tool") ||
    normalized.includes("tool name") ||
    normalized.includes("invalid tool name") ||
    /tool\s+['"`][^'"`]+['"`]\s+not found/.test(normalized) ||
    /tool\s+[a-z0-9_.-]+\s+not found/.test(normalized)
  );
}

function buildCanonicalExecutionBody(toolName: string, input: Record<string, unknown>): Record<string, unknown> {
  return serializeCliToolExecutionRequest({
    name: toolName,
    input,
  });
}

async function discoverCanonicalToolCatalog(
  deps: Pick<CliDeps, "fetch" | "fs" | "homedir">
): Promise<CanonicalDiscoveryResult> {
  try {
    return {
      catalog: parseCliToolsListResponse(await apiGet(deps, CANONICAL_TOOLS_DISCOVERY_PATH)),
      routeUnavailable: false,
    };
  } catch (error) {
    if (shouldRetryCanonicalToolCandidate(error)) {
      return {
        catalog: null,
        routeUnavailable: isCanonicalRouteNotFound(error),
      };
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
  return extractCanonicalExecutionResult(payload, toolName);
}

export async function executeCanonicalToolOnly(
  deps: Pick<CliDeps, "fetch" | "fs" | "homedir">,
  options: ExecuteCanonicalToolOptions
): Promise<unknown> {
  const configured = options.canonicalToolNames.map((name) => name.trim()).filter(Boolean);
  if (configured.length === 0) {
    throw new Error("At least one canonical tool name must be configured.");
  }

  const discovery = await discoverCanonicalToolCatalog(deps);
  const candidates = prioritizedCanonicalToolNames(configured, discovery.catalog);
  let lastRetryableError: unknown = null;
  let allExecutionErrorsWereNotFound = true;
  let foundLikelyToolNameMismatchNotFound = false;

  for (const candidate of candidates) {
    try {
      return await executeCanonicalTool(deps, candidate, options.input);
    } catch (error) {
      if (!shouldRetryCanonicalToolCandidate(error)) {
        throw error;
      }
      if (!isCanonicalRouteNotFound(error)) {
        allExecutionErrorsWereNotFound = false;
      } else {
        if (isLikelyToolNameMismatchNotFoundDetail(error.detail)) {
          foundLikelyToolNameMismatchNotFound = true;
        }
      }
      lastRetryableError = error;
    }
  }

  if (lastRetryableError) {
    if (
      allExecutionErrorsWereNotFound &&
      discovery.routeUnavailable &&
      !foundLikelyToolNameMismatchNotFound
    ) {
      throw new Error(CANONICAL_ROUTE_CUTOVER_GUIDANCE, {
        cause: lastRetryableError instanceof Error ? lastRetryableError : undefined,
      });
    }
    throw lastRetryableError;
  }

  throw new Error("Failed to execute canonical tool.");
}
