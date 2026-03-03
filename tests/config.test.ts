import { describe, expect, it, vi } from "vitest";
import {
  clearPersistedPatToken,
  configPath,
  DEFAULT_CHAT_API_URL,
  DEFAULT_INTERFACE_URL,
  maskToken,
  persistPatToken,
  readConfig,
  requireConfig,
  resolveMaskedToken,
  writeConfig,
} from "../src/config.js";
import { createHarness } from "./helpers.js";

describe("config", () => {
  it("builds config path with the cli directory", () => {
    expect(
      configPath({
        homedir: () => "/tmp/cli-home",
      })
    ).toBe("/tmp/cli-home/.cobuild-cli/config.json");
  });

  it("returns the standard config path", () => {
    const { deps, configFile } = createHarness();
    expect(configPath(deps)).toBe(configFile);
  });

  it("returns empty config when file is missing", () => {
    const { deps } = createHarness();
    expect(readConfig(deps)).toEqual({});
  });

  it("writes and reads config", () => {
    const { deps } = createHarness();
    writeConfig(deps, {
      url: "https://api.example",
      token: "bbt_123",
      agent: "alpha",
    });

    expect(readConfig(deps)).toEqual({
      url: "https://api.example",
      token: "bbt_123",
      agent: "alpha",
    });
  });

  it("persists chatApiUrl when writing config", () => {
    const { deps, configFile, files } = createHarness();
    writeConfig(
      deps,
      {
        url: "https://api.example",
        token: "bbt_123",
        agent: "alpha",
        chatApiUrl: "https://chat.example",
      } as unknown as ReturnType<typeof readConfig>
    );

    const raw = files.get(configFile) ?? "{}";
    expect(raw).toContain('"chatApiUrl": "https://chat.example"');
  });

  it("writes config atomically without leaving temp files", () => {
    const harness = createHarness();
    writeConfig(harness.deps, {
      url: "https://api.example",
      token: "bbt_123",
    });

    const fileKeys = [...harness.files.keys()];
    expect(fileKeys).toEqual([harness.configFile]);
  });

  it("writes config without renameSync fallback support", () => {
    const harness = createHarness();
    harness.deps.fs.renameSync = undefined;

    writeConfig(harness.deps, {
      url: "https://api.example",
      token: "bbt_123",
    });

    expect(JSON.parse(harness.files.get(harness.configFile) ?? "{}")).toEqual({
      url: "https://api.example",
      token: "bbt_123",
    });
  });

  it("falls back to unlink + retry when atomic rename fails", () => {
    const harness = createHarness();
    const originalRename = harness.deps.fs.renameSync;
    let attempts = 0;
    harness.deps.fs.renameSync = (oldPath, newPath) => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("simulated-rename-failure");
      }
      originalRename?.(oldPath, newPath);
    };

    writeConfig(harness.deps, {
      url: "https://api.example",
      token: "bbt_123",
    });

    expect(JSON.parse(harness.files.get(harness.configFile) ?? "{}")).toEqual({
      url: "https://api.example",
      token: "bbt_123",
    });
  });

  it("tightens directory and file permissions after writes", () => {
    const harness = createHarness();
    const chmod = vi.fn();
    harness.deps.fs.chmodSync = chmod;

    writeConfig(harness.deps, {
      url: "https://api.example",
      token: "bbt_123",
    });

    expect(chmod).toHaveBeenNthCalledWith(1, "/tmp/cli-tests/.cobuild-cli", 0o700);
    expect(chmod).toHaveBeenNthCalledWith(2, harness.configFile, 0o600);
  });

  it("throws when config JSON is invalid", () => {
    const { deps } = createHarness({ rawConfig: "{ not-json" });
    expect(() => readConfig(deps)).toThrow(/not valid JSON/);
  });

  it("returns empty config when JSON payload is not an object", () => {
    const { deps } = createHarness({ rawConfig: JSON.stringify("not-an-object") });
    expect(readConfig(deps)).toEqual({});
  });

  it("returns empty config when JSON payload is an array", () => {
    const { deps } = createHarness({ rawConfig: JSON.stringify([{ url: "https://api.example" }]) });
    expect(readConfig(deps)).toEqual({});
  });

  it("requires token and falls back to hardcoded interface/chat urls", () => {
    const missingUrl = createHarness({ config: { token: "bbt_1" } });
    expect(requireConfig(missingUrl.deps)).toEqual({
      url: DEFAULT_INTERFACE_URL,
      chatApiUrl: DEFAULT_CHAT_API_URL,
      token: "bbt_1",
      agent: undefined,
    });

    const missingToken = createHarness({ config: { url: "https://api.example" } });
    expect(() => requireConfig(missingToken.deps)).toThrow(/Missing PAT token/);
  });

  it("returns required config when present", () => {
    const { deps } = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_abc",
        agent: "ops",
      },
    });

    expect(requireConfig(deps)).toEqual({
      url: "https://api.example",
      chatApiUrl: "https://api.example",
      token: "bbt_abc",
      agent: "ops",
    });
  });

  it("resolves required config token from a SecretRef", () => {
    const { deps } = createHarness({
      config: {
        url: "https://api.example",
        agent: "ops",
        auth: {
          tokenRef: {
            source: "env",
            provider: "default",
            id: "COBUILD_PAT",
          },
        },
      },
    });
    deps.env = {
      COBUILD_PAT: "bbt_env_secret",
    };

    expect(requireConfig(deps)).toEqual({
      url: "https://api.example",
      chatApiUrl: "https://api.example",
      token: "bbt_env_secret",
      agent: "ops",
    });
  });

  it("migrates legacy plaintext token to file secret ref when required config is loaded", () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_legacy_secret",
        agent: "ops",
      },
    });

    expect(requireConfig(harness.deps)).toEqual({
      url: "https://api.example",
      chatApiUrl: "https://api.example",
      token: "bbt_legacy_secret",
      agent: "ops",
    });

    const migratedConfig = JSON.parse(harness.files.get(harness.configFile) ?? "{}") as Record<string, unknown>;
    expect(migratedConfig).toEqual({
      url: "https://api.example",
      agent: "ops",
      auth: {
        tokenRef: {
          source: "file",
          provider: "default",
          id: "/pat:https:~1~1api.example",
        },
      },
      secrets: {
        providers: {
          default: {
            source: "file",
            path: "/tmp/cli-tests/.cobuild-cli/secrets.json",
            mode: "json",
          },
        },
        defaults: {
          env: "default",
          file: "default",
          exec: "default",
        },
      },
    });

    const secretsFile = harness.files.get("/tmp/cli-tests/.cobuild-cli/secrets.json");
    expect(secretsFile).toBeTruthy();
    expect(JSON.parse(secretsFile ?? "{}")).toEqual({
      "pat:https://api.example": "bbt_legacy_secret",
    });
  });

  it("preserves chatApiUrl when migrating a legacy plaintext token", () => {
    const harness = createHarness({
      config: {
        url: "https://interface.example",
        chatApiUrl: "https://chat.example",
        token: "bbt_legacy_secret",
      },
    });

    expect(requireConfig(harness.deps)).toEqual({
      url: "https://interface.example",
      chatApiUrl: "https://chat.example",
      token: "bbt_legacy_secret",
      agent: undefined,
    });

    const migratedConfig = JSON.parse(harness.files.get(harness.configFile) ?? "{}") as Record<string, unknown>;
    expect(migratedConfig).toMatchObject({
      url: "https://interface.example",
      chatApiUrl: "https://chat.example",
      auth: {
        tokenRef: {
          source: "file",
          provider: "default",
          id: "/pat:https:~1~1interface.example",
        },
      },
    });
    expect(migratedConfig).not.toHaveProperty("token");
  });

  it("uses legacy token even when migration persistence fails", () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_legacy_secret",
        secrets: {
          providers: {
            default: {
              source: "file",
              path: "/tmp/cli-tests/token.txt",
              mode: "singleValue",
            },
          },
          defaults: {
            file: "default",
          },
        },
      },
    });

    expect(requireConfig(harness.deps)).toEqual({
      url: "https://api.example",
      chatApiUrl: "https://api.example",
      token: "bbt_legacy_secret",
    });
    expect(JSON.parse(harness.files.get(harness.configFile) ?? "{}")).toEqual({
      url: "https://api.example",
      token: "bbt_legacy_secret",
      secrets: {
        providers: {
          default: {
            source: "file",
            path: "/tmp/cli-tests/token.txt",
            mode: "singleValue",
          },
        },
        defaults: {
          file: "default",
        },
      },
    });
  });

  it("strips legacy plaintext token when auth tokenRef is present", () => {
    const harness = createHarness();
    writeConfig(harness.deps, {
      url: "https://api.example",
      token: "bbt_plaintext",
      auth: {
        tokenRef: {
          source: "file",
          provider: "default",
          id: "/pat:https:~1~1api.example",
        },
      },
    });

    const raw = harness.files.get(harness.configFile) ?? "";
    expect(raw).not.toContain("\"token\"");
  });

  it("validates persisted token writes and clears persisted tokens/secrets", () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "legacy",
      },
    });
    const secretsPath = "/tmp/cli-tests/.cobuild-cli/secrets.json";

    expect(() =>
      persistPatToken({
        deps: harness.deps,
        config: {},
        token: "   ",
      })
    ).toThrow("Token cannot be empty");

    const next = persistPatToken({
      deps: harness.deps,
      config: {
        url: "https://api.example",
      },
      token: "bbt_secret",
    });
    writeConfig(harness.deps, next);
    expect(JSON.parse(harness.files.get(secretsPath) ?? "{}")).toEqual({
      "pat:https://api.example": "bbt_secret",
    });

    clearPersistedPatToken(harness.deps);
    const cleared = JSON.parse(harness.files.get(harness.configFile) ?? "{}") as Record<string, unknown>;
    expect(cleared.token).toBeUndefined();
    expect(cleared.auth).toBeUndefined();
    expect(JSON.parse(harness.files.get(secretsPath) ?? "{}")).toEqual({});
  });

  it("persists PAT refs to a JSON provider when defaults.file points to singleValue", () => {
    const harness = createHarness();
    const next = persistPatToken({
      deps: harness.deps,
      config: {
        url: "https://api.example",
        secrets: {
          providers: {
            default: {
              source: "file",
              path: "/tmp/cli-tests/.cobuild-cli/secrets.json",
              mode: "json",
            },
            single: {
              source: "file",
              path: "/tmp/cli-tests/token.txt",
              mode: "singleValue",
            },
          },
          defaults: {
            file: "single",
          },
        },
      },
      token: "bbt_secret",
    });

    expect(next.auth?.tokenRef).toEqual({
      source: "file",
      provider: "default",
      id: "/pat:https:~1~1api.example",
    });
  });

  it("rejects PAT persistence when only singleValue file providers are available", () => {
    const harness = createHarness();
    expect(() =>
      persistPatToken({
        deps: harness.deps,
        config: {
          url: "https://api.example",
          secrets: {
            providers: {
              default: {
                source: "file",
                path: "/tmp/cli-tests/token.txt",
                mode: "singleValue",
              },
            },
            defaults: {
              file: "default",
            },
          },
        },
        token: "bbt_secret",
      })
    ).toThrow('Secret provider "default" uses mode "singleValue" and cannot store structured SecretRef ids.');
  });

  it("requires tokenRef resolution when both tokenRef and legacy token exist", () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_legacy_secret",
        auth: {
          tokenRef: {
            source: "env",
            provider: "default",
            id: "COBUILD_PAT",
          },
        },
      },
    });

    expect(() => requireConfig(harness.deps)).toThrow(
      'Environment variable "COBUILD_PAT" is missing or empty.'
    );

    harness.deps.env = {
      COBUILD_PAT: "bbt_from_env",
    };
    expect(requireConfig(harness.deps)).toEqual({
      url: "https://api.example",
      chatApiUrl: "https://api.example",
      token: "bbt_from_env",
    });
  });

  it("resolves masked token from SecretRef or legacy token fallback", () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_legacy_secret",
        auth: {
          tokenRef: {
            source: "env",
            provider: "default",
            id: "MISSING_TOKEN",
          },
        },
      },
    });

    expect(resolveMaskedToken(harness.deps, readConfig(harness.deps))).toBeNull();

    harness.deps.env = {
      MISSING_TOKEN: "bbt_from_env",
    };
    expect(resolveMaskedToken(harness.deps, readConfig(harness.deps))).toBe("bbt_from...");

    const legacyOnlyHarness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_legacy_secret",
      },
    });
    expect(resolveMaskedToken(legacyOnlyHarness.deps, readConfig(legacyOnlyHarness.deps))).toBe("bbt_lega...");
  });

  it("uses configured chatApiUrl values in existing configs", () => {
    const { deps } = createHarness({
      rawConfig: JSON.stringify(
        {
          url: "https://api.example",
          chatApiUrl: "https://chat.example",
          token: "bbt_abc",
          agent: "ops",
        },
        null,
        2
      ),
    });

    expect(readConfig(deps)).toEqual({
      url: "https://api.example",
      chatApiUrl: "https://chat.example",
      token: "bbt_abc",
      agent: "ops",
    });
  });

  it("uses interface url for chat api when chatApiUrl is missing", () => {
    const { deps } = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_abc",
      },
    });

    expect(requireConfig(deps)).toEqual({
      url: "https://api.example",
      chatApiUrl: "https://api.example",
      token: "bbt_abc",
      agent: undefined,
    });
  });

  it("uses explicit chatApiUrl when provided", () => {
    const { deps } = createHarness({
      config: {
        url: "https://interface.example",
        chatApiUrl: "https://chat.example",
        token: "bbt_abc",
      },
    });

    expect(requireConfig(deps)).toEqual({
      url: "https://interface.example",
      chatApiUrl: "https://chat.example",
      token: "bbt_abc",
      agent: undefined,
    });
  });

  it("uses hardcoded defaults when config has only token", () => {
    const { deps } = createHarness({
      config: {
        token: "bbt_abc",
      },
    });

    expect(requireConfig(deps)).toEqual({
      url: DEFAULT_INTERFACE_URL,
      chatApiUrl: DEFAULT_CHAT_API_URL,
      token: "bbt_abc",
      agent: undefined,
    });
  });

  it("masks token values", () => {
    expect(maskToken(undefined)).toBeNull();
    expect(maskToken("abcdefghijk")).toBe("abcdefgh...");
  });
});
