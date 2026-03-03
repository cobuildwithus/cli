import path from "node:path";
import type { CliConfig, CliDeps } from "./types.js";
import { buildPatTokenRef, isSecretRef } from "./secrets/ref-contract.js";
import {
  deleteSecretRefString,
  resolveSecretRefString,
  setSecretRefString,
  withDefaultSecretProviders,
} from "./secrets/runtime.js";

function stripLegacyPlaintextToken(config: CliConfig): CliConfig {
  if (!Object.prototype.hasOwnProperty.call(config, "token")) {
    return config;
  }
  const record = config as CliConfig & { token?: unknown };
  const { token: _token, ...rest } = record;
  return rest as CliConfig;
}

function stripLegacyPlaintextTokenIfRefExists(config: CliConfig): CliConfig {
  if (!isSecretRef(config.auth?.tokenRef)) {
    return config;
  }
  return stripLegacyPlaintextToken(config);
}

function normalizeConfigForWrite(config: CliConfig): CliConfig {
  return stripLegacyPlaintextTokenIfRefExists(config);
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
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
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

  const payload = JSON.stringify(normalizeConfigForWrite(next), null, 2);

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
  chatApiUrl: string;
  token: string;
  agent?: string;
}

function resolveChatApiBaseUrl(config: CliConfig, interfaceUrl: string): string {
  if (config.chatApiUrlEnabled !== true) {
    return interfaceUrl;
  }
  if (typeof config.chatApiUrl !== "string" || config.chatApiUrl.trim().length === 0) {
    return interfaceUrl;
  }
  return config.chatApiUrl.trim();
}

export function persistPatToken(params: {
  deps: Pick<CliDeps, "fs" | "homedir">;
  config: CliConfig;
  token: string;
  interfaceUrl?: string;
}): CliConfig {
  const normalizedToken = params.token.trim();
  if (!normalizedToken) {
    throw new Error("Token cannot be empty");
  }

  const configWithProviders = withDefaultSecretProviders(params.config, params.deps);
  const tokenRef = buildPatTokenRef(
    configWithProviders,
    params.interfaceUrl ?? configWithProviders.url
  );

  setSecretRefString({
    deps: params.deps,
    config: configWithProviders,
    ref: tokenRef,
    value: normalizedToken,
  });

  const next: CliConfig = {
    ...configWithProviders,
    auth: {
      ...(configWithProviders.auth ?? {}),
      tokenRef,
    },
  };
  return stripLegacyPlaintextToken(next);
}

export function clearPersistedPatToken(deps: Pick<CliDeps, "fs" | "homedir">): void {
  const current = readConfig(deps);
  const hasLegacyToken = typeof current.token === "string" && current.token.trim().length > 0;
  const hasTokenRef = isSecretRef(current.auth?.tokenRef);
  if (!hasLegacyToken && !hasTokenRef) {
    return;
  }

  const configWithProviders = withDefaultSecretProviders(current, deps);

  if (isSecretRef(configWithProviders.auth?.tokenRef)) {
    deleteSecretRefString({
      deps,
      config: configWithProviders,
      ref: configWithProviders.auth.tokenRef,
    });
  }

  const next: CliConfig = { ...configWithProviders };
  if (next.auth) {
    const { tokenRef: _tokenRef, ...restAuth } = next.auth;
    next.auth = Object.keys(restAuth).length > 0 ? restAuth : undefined;
  }
  writeConfig(deps, stripLegacyPlaintextToken(next));
}

export function resolveMaskedToken(
  deps: Pick<CliDeps, "fs" | "homedir" | "env">,
  config: CliConfig
): string | null {
  try {
    if (isSecretRef(config.auth?.tokenRef)) {
      const token = resolveSecretRefString({
        deps,
        config: withDefaultSecretProviders(config, deps),
        ref: config.auth.tokenRef,
      });
      return maskToken(token);
    }
  } catch {
    return null;
  }

  if (typeof config.token === "string") {
    return maskToken(config.token.trim());
  }

  return null;
}

function resolveRequiredToken(deps: Pick<CliDeps, "fs" | "homedir" | "env">, cfg: CliConfig): string {
  if (isSecretRef(cfg.auth?.tokenRef)) {
    return resolveSecretRefString({
      deps,
      config: withDefaultSecretProviders(cfg, deps),
      ref: cfg.auth.tokenRef,
    });
  }

  if (typeof cfg.token === "string" && cfg.token.trim().length > 0) {
    const normalizedLegacyToken = cfg.token.trim();
    try {
      const migrated = persistPatToken({
        deps,
        config: cfg,
        token: normalizedLegacyToken,
        interfaceUrl: cfg.url,
      });
      writeConfig(deps, migrated);
    } catch {
      // best-effort legacy migration: continue with the valid token for this invocation
    }
    return normalizedLegacyToken;
  }

  throw new Error(
    "Missing PAT token. Run: cli setup (recommended) or cli config set --url <url> --token <token>"
  );
}

export function requireConfig(deps: Pick<CliDeps, "fs" | "homedir" | "env">): RequiredConfig {
  const cfg = readConfig(deps);
  const interfaceUrl = typeof cfg.url === "string" ? cfg.url.trim() : "";
  if (!interfaceUrl) {
    throw new Error(
      "Missing interface API base URL. Run: cli setup (recommended) or cli config set --url <url> --token <token>"
    );
  }
  return {
    url: interfaceUrl,
    chatApiUrl: resolveChatApiBaseUrl(cfg, interfaceUrl),
    token: resolveRequiredToken(deps, cfg),
    agent: cfg.agent,
  };
}

export function maskToken(token: string | undefined): string | null {
  if (!token) {
    return null;
  }
  return `${token.slice(0, 8)}...`;
}
