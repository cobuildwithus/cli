import { parseArgs } from "node:util";
import { printJson } from "../output.js";
import { apiPost } from "../transport.js";
import type { CliDeps } from "../types.js";
import { parseIntegerOption } from "./shared.js";

const DOCS_USAGE = "Usage: buildbot docs <query> [--limit <n>]";
const DOCS_LIMIT_MIN = 1;
const DOCS_LIMIT_MAX = 20;

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

  const response = await apiPost(deps, "/api/docs/search", {
    query,
    ...(limit !== undefined ? { limit } : {}),
  });

  printJson(deps, response);
}
