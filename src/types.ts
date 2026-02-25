export interface CliConfig {
  url?: string;
  token?: string;
  agent?: string;
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
    body?: string;
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
