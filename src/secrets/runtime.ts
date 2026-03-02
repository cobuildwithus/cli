import { execFileSync } from "node:child_process";
import path from "node:path";
import type {
  CliConfig,
  CliDeps,
  ExecSecretProviderConfig,
  FileSecretProviderConfig,
  SecretProviderConfig,
  SecretRef,
  SecretRefSource,
} from "../types.js";
import { deleteJsonPointer, readJsonPointer, writeJsonPointer } from "./json-pointer.js";
import {
  DEFAULT_SECRET_PROVIDER_ALIAS,
  SINGLE_VALUE_FILE_REF_ID,
  resolveDefaultSecretProviderAlias,
  secretRefKey,
} from "./ref-contract.js";

const DEFAULT_EXEC_TIMEOUT_MS = 5_000;
const DEFAULT_EXEC_MAX_OUTPUT_BYTES = 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizePositiveInt(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
}

function resolveUserPath(inputPath: string, deps: Pick<CliDeps, "homedir">): string {
  const trimmed = inputPath.trim();
  if (!trimmed) {
    throw new Error("Secret provider path cannot be empty.");
  }
  if (trimmed === "~") {
    return deps.homedir();
  }
  if (trimmed.startsWith("~/")) {
    return path.join(deps.homedir(), trimmed.slice(2));
  }
  return trimmed;
}

function defaultSecretsFilePath(deps: Pick<CliDeps, "homedir">): string {
  return path.join(deps.homedir(), ".cobuild-cli", "secrets.json");
}

export function withDefaultSecretProviders(
  config: CliConfig,
  deps: Pick<CliDeps, "homedir">
): CliConfig {
  const providers = { ...(config.secrets?.providers ?? {}) };
  if (!providers[DEFAULT_SECRET_PROVIDER_ALIAS]) {
    providers[DEFAULT_SECRET_PROVIDER_ALIAS] = {
      source: "file",
      path: defaultSecretsFilePath(deps),
      mode: "json",
    };
  }

  const defaults = { ...(config.secrets?.defaults ?? {}) };
  if (!defaults.file) defaults.file = DEFAULT_SECRET_PROVIDER_ALIAS;
  if (!defaults.env) defaults.env = DEFAULT_SECRET_PROVIDER_ALIAS;
  if (!defaults.exec) defaults.exec = DEFAULT_SECRET_PROVIDER_ALIAS;

  return {
    ...config,
    secrets: {
      ...(config.secrets ?? {}),
      providers,
      defaults,
    },
  };
}

function resolveConfiguredProvider(ref: SecretRef, config: CliConfig): SecretProviderConfig {
  const providerConfig = config.secrets?.providers?.[ref.provider];
  if (providerConfig) {
    if (providerConfig.source === ref.source) {
      return providerConfig;
    }

    const defaultAlias = resolveDefaultSecretProviderAlias(config, ref.source);
    if (ref.source === "env" && ref.provider === defaultAlias) {
      // Allow a virtual default env provider even when this alias is used by
      // a non-env configured provider (for example file-backed default storage).
      return { source: "env" };
    }

    throw new Error(
      `Secret provider \"${ref.provider}\" has source \"${providerConfig.source}\" but ref requests \"${ref.source}\".`
    );
  }

  if (ref.source === "env" && ref.provider === resolveDefaultSecretProviderAlias(config, "env")) {
    return { source: "env" };
  }

  throw new Error(
    `Secret provider \"${ref.provider}\" is not configured (ref: ${ref.source}:${ref.provider}:${ref.id}).`
  );
}

function readFileProviderPayload(params: {
  deps: Pick<CliDeps, "fs" | "homedir">;
  providerName: string;
  providerConfig: FileSecretProviderConfig;
}): unknown {
  const filePath = resolveUserPath(params.providerConfig.path, params.deps);

  let raw = "";
  try {
    raw = params.deps.fs.readFileSync(filePath, "utf8");
  } catch (error) {
    throw new Error(
      `Failed to read file secret provider \"${params.providerName}\": ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  const mode = params.providerConfig.mode ?? "json";
  if (mode === "singleValue") {
    return raw.replace(/\r?\n$/, "");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      `File secret provider \"${params.providerName}\" must contain valid JSON for mode \"json\".`
    );
  }
  if (!isRecord(parsed)) {
    throw new Error(`File secret provider \"${params.providerName}\" JSON payload must be an object.`);
  }
  return parsed;
}

function resolveEnvSecretRef(params: {
  ref: SecretRef;
  providerConfig: Extract<SecretProviderConfig, { source: "env" }>;
  deps: Pick<CliDeps, "env">;
}): unknown {
  const allowlist = params.providerConfig.allowlist
    ? new Set(params.providerConfig.allowlist)
    : null;
  if (allowlist && !allowlist.has(params.ref.id)) {
    throw new Error(
      `Environment variable \"${params.ref.id}\" is not allowlisted for provider \"${params.ref.provider}\".`
    );
  }

  const env = params.deps.env ?? process.env;
  const value = env[params.ref.id];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Environment variable \"${params.ref.id}\" is missing or empty.`);
  }
  return value.trim();
}

function parseExecValues(params: {
  providerName: string;
  id: string;
  stdout: string;
  jsonOnly: boolean;
}): Record<string, unknown> {
  const trimmed = params.stdout.trim();
  if (!trimmed) {
    throw new Error(`Exec provider \"${params.providerName}\" returned empty stdout.`);
  }

  let parsed: unknown;
  if (!params.jsonOnly) {
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return { [params.id]: trimmed };
    }
  } else {
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error(`Exec provider \"${params.providerName}\" returned invalid JSON.`);
    }
  }

  if (!isRecord(parsed)) {
    if (!params.jsonOnly && typeof parsed === "string") {
      return { [params.id]: parsed };
    }
    throw new Error(`Exec provider \"${params.providerName}\" response must be an object.`);
  }

  if (parsed.protocolVersion !== 1) {
    throw new Error(`Exec provider \"${params.providerName}\" protocolVersion must be 1.`);
  }

  const values = parsed.values;
  if (!isRecord(values)) {
    throw new Error(`Exec provider \"${params.providerName}\" response missing \"values\".`);
  }

  const errors = isRecord(parsed.errors) ? parsed.errors : null;
  if (errors && params.id in errors) {
    const entry = errors[params.id];
    if (isRecord(entry) && typeof entry.message === "string" && entry.message.trim()) {
      throw new Error(
        `Exec provider \"${params.providerName}\" failed for id \"${params.id}\" (${entry.message.trim()}).`
      );
    }
    throw new Error(`Exec provider \"${params.providerName}\" failed for id \"${params.id}\".`);
  }

  if (!(params.id in values)) {
    throw new Error(`Exec provider \"${params.providerName}\" response missing id \"${params.id}\".`);
  }

  return values;
}

function resolveExecSecretRef(params: {
  ref: SecretRef;
  providerConfig: ExecSecretProviderConfig;
  deps: Pick<CliDeps, "homedir" | "env">;
}): unknown {
  const commandPath = resolveUserPath(params.providerConfig.command, params.deps);
  if (!path.isAbsolute(commandPath)) {
    throw new Error("Exec provider command must be an absolute path.");
  }

  const passEnv = params.providerConfig.passEnv ?? [];
  const sourceEnv = params.deps.env ?? process.env;
  const childEnv: NodeJS.ProcessEnv = {};
  for (const key of passEnv) {
    const value = sourceEnv[key] ?? process.env[key];
    if (value !== undefined) {
      childEnv[key] = value;
    }
  }
  for (const [key, value] of Object.entries(params.providerConfig.env ?? {})) {
    childEnv[key] = value;
  }

  const timeoutMs = normalizePositiveInt(params.providerConfig.timeoutMs, DEFAULT_EXEC_TIMEOUT_MS);
  const maxOutputBytes = normalizePositiveInt(
    params.providerConfig.maxOutputBytes,
    DEFAULT_EXEC_MAX_OUTPUT_BYTES
  );
  const jsonOnly = params.providerConfig.jsonOnly ?? true;

  const input = JSON.stringify({
    protocolVersion: 1,
    provider: params.ref.provider,
    ids: [params.ref.id],
  });

  let stdout = "";
  try {
    stdout = execFileSync(commandPath, params.providerConfig.args ?? [], {
      cwd: path.dirname(commandPath),
      env: childEnv,
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: maxOutputBytes,
      input,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (error) {
    throw new Error(
      `Exec provider \"${params.ref.provider}\" failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  const values = parseExecValues({
    providerName: params.ref.provider,
    id: params.ref.id,
    stdout,
    jsonOnly,
  });

  return values[params.ref.id];
}

function resolveSecretRefValue(params: {
  deps: Pick<CliDeps, "fs" | "homedir" | "env">;
  config: CliConfig;
  ref: SecretRef;
}): unknown {
  const providerConfig = resolveConfiguredProvider(params.ref, params.config);

  if (providerConfig.source === "env") {
    return resolveEnvSecretRef({
      ref: params.ref,
      providerConfig,
      deps: params.deps,
    });
  }

  if (providerConfig.source === "file") {
    const payload = readFileProviderPayload({
      deps: params.deps,
      providerName: params.ref.provider,
      providerConfig,
    });
    const mode = providerConfig.mode ?? "json";
    if (mode === "singleValue") {
      if (params.ref.id !== SINGLE_VALUE_FILE_REF_ID) {
        throw new Error(
          `singleValue file provider \"${params.ref.provider}\" expects ref id \"${SINGLE_VALUE_FILE_REF_ID}\".`
        );
      }
      return payload;
    }
    return readJsonPointer(payload, params.ref.id);
  }

  if (providerConfig.source === "exec") {
    return resolveExecSecretRef({
      ref: params.ref,
      providerConfig,
      deps: params.deps,
    });
  }

  throw new Error(`Unsupported secret provider source: ${(providerConfig as { source?: unknown }).source}`);
}

function tightenSecretPermissions(
  deps: Pick<CliDeps, "fs">,
  directory: string,
  filePath: string
): void {
  try {
    deps.fs.chmodSync?.(directory, 0o700);
  } catch {
    // best-effort on platforms/filesystems without chmod support
  }
  try {
    deps.fs.chmodSync?.(filePath, 0o600);
  } catch {
    // best-effort on platforms/filesystems without chmod support
  }
}

function writeSecretFileAtomically(params: {
  deps: Pick<CliDeps, "fs">;
  filePath: string;
  content: string;
}): void {
  const directory = path.dirname(params.filePath);
  params.deps.fs.mkdirSync(directory, { recursive: true, mode: 0o700 });

  if (params.deps.fs.renameSync) {
    const tmpPath = path.join(directory, `secrets.${process.pid}.${Date.now()}.tmp`);
    params.deps.fs.writeFileSync(tmpPath, params.content, { encoding: "utf8", mode: 0o600 });
    try {
      params.deps.fs.renameSync(tmpPath, params.filePath);
    } catch {
      try {
        params.deps.fs.unlinkSync?.(params.filePath);
      } catch {
        // ignore cleanup failures
      }
      params.deps.fs.renameSync(tmpPath, params.filePath);
    }
    tightenSecretPermissions(params.deps, directory, params.filePath);
    return;
  }

  params.deps.fs.writeFileSync(params.filePath, params.content, { encoding: "utf8", mode: 0o600 });
  tightenSecretPermissions(params.deps, directory, params.filePath);
}

function readFileSecretPayloadForWrite(params: {
  deps: Pick<CliDeps, "fs" | "homedir">;
  providerName: string;
  providerConfig: FileSecretProviderConfig;
}): Record<string, unknown> {
  const filePath = resolveUserPath(params.providerConfig.path, params.deps);
  if (!params.deps.fs.existsSync(filePath)) {
    return {};
  }

  const payload = readFileProviderPayload({
    deps: params.deps,
    providerName: params.providerName,
    providerConfig: params.providerConfig,
  });
  if (!isRecord(payload)) {
    throw new Error(
      `File secret provider \"${params.providerName}\" payload must be an object for write operations.`
    );
  }
  return payload;
}

function writeFileSecretPayload(params: {
  deps: Pick<CliDeps, "fs" | "homedir">;
  providerConfig: FileSecretProviderConfig;
  payload: Record<string, unknown>;
}): void {
  const filePath = resolveUserPath(params.providerConfig.path, params.deps);
  writeSecretFileAtomically({
    deps: params.deps,
    filePath,
    content: `${JSON.stringify(params.payload, null, 2)}\n`,
  });
}

export function resolveSecretRefString(params: {
  deps: Pick<CliDeps, "fs" | "homedir" | "env">;
  config: CliConfig;
  ref: SecretRef;
}): string {
  const config = withDefaultSecretProviders(params.config, params.deps);
  const value = resolveSecretRefValue({
    deps: params.deps,
    config,
    ref: params.ref,
  });

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(
      `Secret reference \"${secretRefKey(params.ref)}\" resolved to a non-string or empty value.`
    );
  }
  return value.trim();
}

export function setSecretRefString(params: {
  deps: Pick<CliDeps, "fs" | "homedir">;
  config: CliConfig;
  ref: SecretRef;
  value: string;
}): void {
  const config = withDefaultSecretProviders(params.config, params.deps);
  const providerConfig = resolveConfiguredProvider(params.ref, config);
  const normalizedValue = params.value.trim();
  if (!normalizedValue) {
    throw new Error("Secret value cannot be empty.");
  }

  if (providerConfig.source !== "file") {
    throw new Error(
      `Secret writes are only supported for file providers. Ref source \"${params.ref.source}\" is read-only.`
    );
  }

  const mode = providerConfig.mode ?? "json";
  if (mode === "singleValue") {
    if (params.ref.id !== SINGLE_VALUE_FILE_REF_ID) {
      throw new Error(
        `singleValue file provider \"${params.ref.provider}\" expects ref id \"${SINGLE_VALUE_FILE_REF_ID}\".`
      );
    }
    const filePath = resolveUserPath(providerConfig.path, params.deps);
    writeSecretFileAtomically({
      deps: params.deps,
      filePath,
      content: `${normalizedValue}\n`,
    });
    return;
  }

  const payload = readFileSecretPayloadForWrite({
    deps: params.deps,
    providerName: params.ref.provider,
    providerConfig,
  });
  writeJsonPointer(payload, params.ref.id, normalizedValue);
  writeFileSecretPayload({
    deps: params.deps,
    providerConfig,
    payload,
  });
}

export function deleteSecretRefString(params: {
  deps: Pick<CliDeps, "fs" | "homedir">;
  config: CliConfig;
  ref: SecretRef;
}): void {
  const config = withDefaultSecretProviders(params.config, params.deps);
  const providerConfig = resolveConfiguredProvider(params.ref, config);
  if (providerConfig.source !== "file") {
    return;
  }

  const mode = providerConfig.mode ?? "json";
  const filePath = resolveUserPath(providerConfig.path, params.deps);

  if (!params.deps.fs.existsSync(filePath)) {
    return;
  }

  if (mode === "singleValue") {
    if (params.ref.id !== SINGLE_VALUE_FILE_REF_ID) {
      return;
    }
    writeSecretFileAtomically({
      deps: params.deps,
      filePath,
      content: "\n",
    });
    return;
  }

  let payload: unknown;
  try {
    payload = readFileProviderPayload({
      deps: params.deps,
      providerName: params.ref.provider,
      providerConfig,
    });
  } catch {
    return;
  }
  if (!isRecord(payload)) {
    return;
  }

  const deleted = deleteJsonPointer(payload, params.ref.id);
  if (!deleted) {
    return;
  }

  writeFileSecretPayload({
    deps: params.deps,
    providerConfig,
    payload,
  });
}

export function createSecretRef(params: {
  config: CliConfig;
  source: SecretRefSource;
  id: string;
}): SecretRef {
  return {
    source: params.source,
    provider: resolveDefaultSecretProviderAlias(params.config, params.source),
    id: params.id,
  };
}
