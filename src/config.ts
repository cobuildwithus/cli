import path from "node:path";
import type { CliConfig, CliDeps } from "./types.js";

function stripDeprecatedChatApiUrl(config: CliConfig): CliConfig {
  if (!Object.prototype.hasOwnProperty.call(config, "chatApiUrl")) {
    return config;
  }
  const record = config as CliConfig & { chatApiUrl?: unknown };
  const { chatApiUrl: _chatApiUrl, ...rest } = record;
  return rest as CliConfig;
}

export function configPath(deps: Pick<CliDeps, "homedir">): string {
  return path.join(deps.homedir(), ".cobuild-cli", "config.json");
}

function tightenConfigPermissions(
  deps: Pick<CliDeps, "fs">,
  dir: string,
  file: string
): void {
  try {
    deps.fs.chmodSync?.(dir, 0o700);
  } catch {
    // best-effort on platforms/filesystems without chmod support
  }
  try {
    deps.fs.chmodSync?.(file, 0o600);
  } catch {
    // best-effort on platforms/filesystems without chmod support
  }
}

export function readConfig(deps: Pick<CliDeps, "fs" | "homedir">): CliConfig {
  const file = configPath(deps);
  if (!deps.fs.existsSync(file)) {
    return {};
  }

  const raw = deps.fs.readFileSync(file, "utf8");
  try {
    const parsed = JSON.parse(raw) as CliConfig;
    if (parsed && typeof parsed === "object") {
      return stripDeprecatedChatApiUrl(parsed);
    }
    return {};
  } catch {
    throw new Error(`Config file is not valid JSON: ${file}`);
  }
}

export function writeConfig(deps: Pick<CliDeps, "fs" | "homedir">, next: CliConfig): void {
  const file = configPath(deps);
  const dir = path.dirname(file);
  deps.fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

  const payload = JSON.stringify(stripDeprecatedChatApiUrl(next), null, 2);

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
    tightenConfigPermissions(deps, dir, file);
    return;
  }

  deps.fs.writeFileSync(file, payload, { encoding: "utf8", mode: 0o600 });
  tightenConfigPermissions(deps, dir, file);
}

export interface RequiredConfig {
  url: string;
  token: string;
  agent?: string;
}

export function requireConfig(deps: Pick<CliDeps, "fs" | "homedir">): RequiredConfig {
  const cfg = readConfig(deps);
  if (!cfg.url) {
    throw new Error(
      "Missing interface API base URL. Run: cli setup (recommended) or cli config set --url <url> --token <token>"
    );
  }
  if (!cfg.token) {
    throw new Error(
      "Missing PAT token. Run: cli setup (recommended) or cli config set --url <url> --token <token>"
    );
  }
  return {
    url: cfg.url,
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
