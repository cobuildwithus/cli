export type SecretRefSource = "env" | "file" | "exec";

export interface SecretRef {
  source: SecretRefSource;
  provider: string;
  id: string;
}

export type SecretInput = string | SecretRef;

export interface EnvSecretProviderConfig {
  source: "env";
  allowlist?: string[];
}

export type FileSecretProviderMode = "singleValue" | "json";

export interface FileSecretProviderConfig {
  source: "file";
  path: string;
  mode?: FileSecretProviderMode;
}

export interface ExecSecretProviderConfig {
  source: "exec";
  command: string;
  args?: string[];
  timeoutMs?: number;
  maxOutputBytes?: number;
  jsonOnly?: boolean;
  env?: Record<string, string>;
  passEnv?: string[];
}

export type SecretProviderConfig =
  | EnvSecretProviderConfig
  | FileSecretProviderConfig
  | ExecSecretProviderConfig;

export interface CliSecretsConfig {
  providers?: Record<string, SecretProviderConfig>;
  defaults?: {
    env?: string;
    file?: string;
    exec?: string;
  };
}

export interface CliAuthConfig {
  tokenRef?: SecretRef;
}

export interface CliConfig {
  url?: string;
  chatApiUrl?: string;
  token?: string;
  agent?: string;
  auth?: CliAuthConfig;
  secrets?: CliSecretsConfig;
}

export interface FsLike {
  existsSync(path: string): boolean;
  readFileSync(path: string, encoding: BufferEncoding): string;
  mkdirSync(path: string, options?: { recursive?: boolean; mode?: number }): void;
  writeFileSync(
    path: string,
    data: string,
    options?: BufferEncoding | { encoding?: BufferEncoding; mode?: number }
  ): void;
  chmodSync?: (path: string, mode: number) => void;
  renameSync?: (oldPath: string, newPath: string) => void;
  unlinkSync?: (path: string) => void;
}

export interface FetchResponseLike {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

export type FetchLike = (
  input: URL | string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
    signal?: AbortSignal;
  }
) => Promise<FetchResponseLike>;

export interface CliDeps {
  fs: FsLike;
  homedir: () => string;
  fetch: FetchLike;
  randomUUID: () => string;
  openExternal?: (url: string) => Promise<boolean> | boolean;
  env?: NodeJS.ProcessEnv;
  isInteractive?: () => boolean;
  readStdin?: () => Promise<string>;
  runSetupLinkGlobal?: (params: {
    cwd: string;
    command: string;
    args: string[];
  }) => Promise<{ ok: boolean; output: string }>;
  stdout: (message: string) => void;
  stderr: (message: string) => void;
  exit: (code: number) => never | void;
}
