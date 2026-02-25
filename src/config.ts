import path from "node:path";
import type { BuildBotConfig, CliDeps } from "./types.js";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const DEFAULT_CHAT_API_URL = "https://chat-api.co.build";

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase();
}

function formatLoopbackHost(hostname: string): string {
  const normalized = normalizeHostname(hostname);
  if (normalized === "::1" || normalized === "[::1]") return "[::1]";
  return normalized;
}

function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(normalizeHostname(hostname));
}

export function deriveChatApiUrlFromInterface(interfaceUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(interfaceUrl);
  } catch {
    throw new Error("Interface API base URL is invalid. Use an absolute https URL.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Interface API base URL must not include username or password.");
  }

  if (isLoopbackHost(parsed.hostname)) {
    return `http://${formatLoopbackHost(parsed.hostname)}:4000`;
  }

  const host = normalizeHostname(parsed.hostname);
  if (host === "co.build" || host === "www.co.build") {
    return DEFAULT_CHAT_API_URL;
  }

  return parsed.origin;
}

function getConfiguredChatApiUrl(config: BuildBotConfig): string | null {
  if (typeof config.chatApiUrl !== "string") return null;
  const trimmed = config.chatApiUrl.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function resolveChatApiUrl(config: BuildBotConfig): string {
  const configured = getConfiguredChatApiUrl(config);
  if (configured) return configured;

  if (typeof config.url === "string" && config.url.trim().length > 0) {
    return deriveChatApiUrlFromInterface(config.url.trim());
  }

  return DEFAULT_CHAT_API_URL;
}

export function configPath(deps: Pick<CliDeps, "homedir">): string {
  return path.join(deps.homedir(), ".buildbot", "config.json");
}

export function readConfig(deps: Pick<CliDeps, "fs" | "homedir">): BuildBotConfig {
  const file = configPath(deps);
  if (!deps.fs.existsSync(file)) {
    return {};
  }

  const raw = deps.fs.readFileSync(file, "utf8");
  try {
    const parsed = JSON.parse(raw) as BuildBotConfig;
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
    return {};
  } catch {
    throw new Error(`Config file is not valid JSON: ${file}`);
  }
}

export function writeConfig(deps: Pick<CliDeps, "fs" | "homedir">, next: BuildBotConfig): void {
  const file = configPath(deps);
  const dir = path.dirname(file);
  deps.fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

  const payload = JSON.stringify(next, null, 2);

  if (deps.fs.renameSync) {
    const tmp = path.join(dir, `config.${process.pid}.${Date.now()}.tmp`);
    deps.fs.writeFileSync(tmp, payload, { encoding: "utf8", mode: 0o600 });
    try {
      deps.fs.renameSync(tmp, file);
    } catch {
      try {
        deps.fs.unlinkSync?.(file);
      } catch {
        // ignore cleanup failures
      }
      deps.fs.renameSync(tmp, file);
    }
    return;
  }

  deps.fs.writeFileSync(file, payload, { encoding: "utf8", mode: 0o600 });
}

export interface RequiredConfig {
  url: string;
  chatApiUrl: string;
  token: string;
  agent?: string;
}

export function requireConfig(deps: Pick<CliDeps, "fs" | "homedir">): RequiredConfig {
  const cfg = readConfig(deps);
  if (!cfg.url) {
    throw new Error(
      "Missing interface API base URL. Run: buildbot setup (recommended) or buildbot config set --url <url> --token <token>"
    );
  }
  if (!cfg.token) {
    throw new Error(
      "Missing PAT token. Run: buildbot setup (recommended) or buildbot config set --url <url> --token <token>"
    );
  }
  return {
    url: cfg.url,
    chatApiUrl: resolveChatApiUrl(cfg),
    token: cfg.token,
    agent: cfg.agent,
  };
}

export function maskToken(token: string | undefined): string | null {
  if (!token) {
    return null;
  }
  return `${token.slice(0, 8)}...`;
}
