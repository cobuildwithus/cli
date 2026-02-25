import { vi } from "vitest";
import type { BuildBotConfig, CliDeps, FetchLike, FetchResponseLike } from "../src/types.js";

interface CreateHarnessOptions {
  config?: BuildBotConfig;
  rawConfig?: string;
  fetchResponder?: (input: URL | string, init?: Parameters<FetchLike>[1]) => Promise<FetchResponseLike>;
}

export interface TestHarness {
  deps: CliDeps;
  outputs: string[];
  errors: string[];
  exitCodes: number[];
  fetchMock: ReturnType<typeof vi.fn>;
  files: Map<string, string>;
  configFile: string;
}

export function createHarness(options: CreateHarnessOptions = {}): TestHarness {
  const outputs: string[] = [];
  const errors: string[] = [];
  const exitCodes: number[] = [];
  const files = new Map<string, string>();
  const home = "/tmp/buildbot-tests";
  const configFile = `${home}/.buildbot/config.json`;

  if (options.rawConfig !== undefined) {
    files.set(configFile, options.rawConfig);
  } else if (options.config) {
    files.set(configFile, JSON.stringify(options.config, null, 2));
  }

  const fetchResponder =
    options.fetchResponder ??
    (async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true }),
    }));

  const fetchMock = vi.fn(fetchResponder);

  const deps: CliDeps = {
    fs: {
      existsSync: (file) => files.has(file),
      readFileSync: (file) => {
        const value = files.get(file);
        if (value === undefined) {
          throw new Error(`ENOENT: ${file}`);
        }
        return value;
      },
      mkdirSync: () => {},
      writeFileSync: (file, data) => {
        files.set(file, data);
      },
      renameSync: (oldPath, newPath) => {
        const data = files.get(oldPath);
        if (data === undefined) {
          throw new Error(`ENOENT: ${oldPath}`);
        }
        files.set(newPath, data);
        files.delete(oldPath);
      },
      unlinkSync: (file) => {
        files.delete(file);
      },
    },
    homedir: () => home,
    fetch: fetchMock,
    randomUUID: () => "8e03978e-40d5-43e8-bc93-6894a57f9324",
    stdout: (message) => {
      outputs.push(message);
    },
    stderr: (message) => {
      errors.push(message);
    },
    exit: (code) => {
      exitCodes.push(code);
    },
  };

  return {
    deps,
    outputs,
    errors,
    exitCodes,
    fetchMock,
    files,
    configFile,
  };
}
