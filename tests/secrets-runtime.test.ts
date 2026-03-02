import { describe, expect, it } from "vitest";
import type { CliConfig, CliDeps, SecretRef } from "../src/types.js";
import { DEFAULT_SECRET_PROVIDER_ALIAS, SINGLE_VALUE_FILE_REF_ID } from "../src/secrets/ref-contract.js";
import {
  createSecretRef,
  deleteSecretRefString,
  resolveSecretRefString,
  setSecretRefString,
  withDefaultSecretProviders,
} from "../src/secrets/runtime.js";
import { createHarness } from "./helpers.js";

function defaultFileRef(id: string): SecretRef {
  return {
    source: "file",
    provider: DEFAULT_SECRET_PROVIDER_ALIAS,
    id,
  };
}

function execProviderConfig(
  script: string,
  overrides: Partial<CliConfig["secrets"] extends infer T ? T : never> = {}
): CliConfig {
  return {
    secrets: {
      providers: {
        execer: {
          source: "exec",
          command: process.execPath,
          args: ["-e", script],
        },
      },
      defaults: {
        exec: "execer",
      },
      ...(overrides ?? {}),
    },
  };
}

describe("secrets runtime", () => {
  it("adds default providers/default aliases and preserves existing settings", () => {
    const harness = createHarness();

    const next = withDefaultSecretProviders(
      {
        secrets: {
          providers: {
            customFile: {
              source: "file",
              path: "/tmp/custom-secrets.json",
            },
          },
          defaults: {
            env: "env-provider",
          },
        },
      },
      harness.deps
    );

    expect(next.secrets?.providers?.customFile).toEqual({
      source: "file",
      path: "/tmp/custom-secrets.json",
    });
    expect(next.secrets?.providers?.default).toEqual({
      source: "file",
      path: "/tmp/cli-tests/.cobuild-cli/secrets.json",
      mode: "json",
    });
    expect(next.secrets?.defaults).toEqual({
      env: "env-provider",
      file: "default",
      exec: "default",
    });
  });

  it("writes, resolves, and deletes JSON file-backed refs", () => {
    const harness = createHarness();
    const config: CliConfig = {};
    const ref = defaultFileRef("/nested/token");

    setSecretRefString({
      deps: harness.deps,
      config,
      ref,
      value: "  bbt_secret  ",
    });

    expect(resolveSecretRefString({ deps: harness.deps, config, ref })).toBe("bbt_secret");
    expect(JSON.parse(harness.files.get("/tmp/cli-tests/.cobuild-cli/secrets.json") ?? "{}")).toEqual({
      nested: {
        token: "bbt_secret",
      },
    });

    deleteSecretRefString({
      deps: harness.deps,
      config,
      ref,
    });
    expect(JSON.parse(harness.files.get("/tmp/cli-tests/.cobuild-cli/secrets.json") ?? "{}")).toEqual({
      nested: {},
    });
  });

  it("rejects empty writes and non-file write targets", () => {
    const harness = createHarness();

    expect(() =>
      setSecretRefString({
        deps: harness.deps,
        config: {},
        ref: defaultFileRef("/token"),
        value: "   ",
      })
    ).toThrow("Secret value cannot be empty.");

    expect(() =>
      setSecretRefString({
        deps: harness.deps,
        config: {
          secrets: {
            providers: {
              envProvider: { source: "env" },
            },
            defaults: {
              env: "envProvider",
            },
          },
        },
        ref: {
          source: "env",
          provider: "envProvider",
          id: "COBUILD_PAT",
        },
        value: "bbt_secret",
      })
    ).toThrow('Secret writes are only supported for file providers. Ref source "env" is read-only.');
  });

  it("supports singleValue file providers and validates singleValue ids", () => {
    const harness = createHarness();
    const config: CliConfig = {
      secrets: {
        providers: {
          single: {
            source: "file",
            path: "~/token.txt",
            mode: "singleValue",
          },
        },
        defaults: {
          file: "single",
        },
      },
    };
    harness.files.set("/tmp/cli-tests/token.txt", "bbt_secret\n");

    const singleRef: SecretRef = {
      source: "file",
      provider: "single",
      id: SINGLE_VALUE_FILE_REF_ID,
    };
    expect(resolveSecretRefString({ deps: harness.deps, config, ref: singleRef })).toBe("bbt_secret");

    const wrongRef: SecretRef = {
      source: "file",
      provider: "single",
      id: "/token",
    };
    expect(() => resolveSecretRefString({ deps: harness.deps, config, ref: wrongRef })).toThrow(
      'singleValue file provider "single" expects ref id "value".'
    );
    expect(() =>
      setSecretRefString({
        deps: harness.deps,
        config,
        ref: wrongRef,
        value: "next",
      })
    ).toThrow('singleValue file provider "single" expects ref id "value".');

    setSecretRefString({
      deps: harness.deps,
      config,
      ref: singleRef,
      value: "next",
    });
    expect(harness.files.get("/tmp/cli-tests/token.txt")).toBe("next\n");

    deleteSecretRefString({
      deps: harness.deps,
      config,
      ref: wrongRef,
    });
    expect(harness.files.get("/tmp/cli-tests/token.txt")).toBe("next\n");

    deleteSecretRefString({
      deps: harness.deps,
      config,
      ref: singleRef,
    });
    expect(harness.files.get("/tmp/cli-tests/token.txt")).toBe("\n");
  });

  it("handles provider resolution errors and env-provider allowlist rules", () => {
    const harness = createHarness();
    harness.deps.env = {
      COBUILD_PAT: " bb_token ",
      ALLOWED: " env_secret ",
    };

    const defaultAliasCollisionConfig: CliConfig = {
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
        },
      },
    };

    expect(
      resolveSecretRefString({
        deps: harness.deps,
        config: defaultAliasCollisionConfig,
        ref: {
          source: "env",
          provider: "default",
          id: "COBUILD_PAT",
        },
      })
    ).toBe("bb_token");

    expect(() =>
      resolveSecretRefString({
        deps: harness.deps,
        config: {
          secrets: {
            providers: {
              vault: {
                source: "file",
                path: "/tmp/cli-tests/.cobuild-cli/secrets.json",
              },
            },
          },
        },
        ref: {
          source: "exec",
          provider: "vault",
          id: "token",
        },
      })
    ).toThrow('Secret provider "vault" has source "file" but ref requests "exec".');

    expect(() =>
      resolveSecretRefString({
        deps: harness.deps,
        config: {},
        ref: {
          source: "file",
          provider: "missing",
          id: "/token",
        },
      })
    ).toThrow('Secret provider "missing" is not configured');

    const allowlistedConfig: CliConfig = {
      secrets: {
        providers: {
          envOnly: {
            source: "env",
            allowlist: ["ALLOWED"],
          },
        },
      },
    };
    expect(
      resolveSecretRefString({
        deps: harness.deps,
        config: allowlistedConfig,
        ref: {
          source: "env",
          provider: "envOnly",
          id: "ALLOWED",
        },
      })
    ).toBe("env_secret");
    expect(() =>
      resolveSecretRefString({
        deps: harness.deps,
        config: allowlistedConfig,
        ref: {
          source: "env",
          provider: "envOnly",
          id: "DENIED",
        },
      })
    ).toThrow('Environment variable "DENIED" is not allowlisted');
    expect(() =>
      resolveSecretRefString({
        deps: harness.deps,
        config: allowlistedConfig,
        ref: {
          source: "env",
          provider: "envOnly",
          id: "MISSING",
        },
      })
    ).toThrow('Environment variable "MISSING" is not allowlisted');
  });

  it("throws for bad file-provider paths and payloads", () => {
    const harness = createHarness();

    expect(() =>
      resolveSecretRefString({
        deps: harness.deps,
        config: {
          secrets: {
            providers: {
              badPath: {
                source: "file",
                path: "   ",
              },
            },
          },
        },
        ref: {
          source: "file",
          provider: "badPath",
          id: "/token",
        },
      })
    ).toThrow("Secret provider path cannot be empty.");

    expect(() =>
      resolveSecretRefString({
        deps: harness.deps,
        config: {
          secrets: {
            providers: {
              missingFile: {
                source: "file",
                path: "/tmp/cli-tests/missing.json",
              },
            },
          },
        },
        ref: {
          source: "file",
          provider: "missingFile",
          id: "/token",
        },
      })
    ).toThrow('Failed to read file secret provider "missingFile"');

    harness.files.set("/tmp/cli-tests/invalid-json.json", "{");
    expect(() =>
      resolveSecretRefString({
        deps: harness.deps,
        config: {
          secrets: {
            providers: {
              invalidJson: {
                source: "file",
                path: "/tmp/cli-tests/invalid-json.json",
              },
            },
          },
        },
        ref: {
          source: "file",
          provider: "invalidJson",
          id: "/token",
        },
      })
    ).toThrow('File secret provider "invalidJson" must contain valid JSON for mode "json".');

    harness.files.set("/tmp/cli-tests/non-object.json", '"raw"');
    expect(() =>
      resolveSecretRefString({
        deps: harness.deps,
        config: {
          secrets: {
            providers: {
              nonObject: {
                source: "file",
                path: "/tmp/cli-tests/non-object.json",
              },
            },
          },
        },
        ref: {
          source: "file",
          provider: "nonObject",
          id: "/token",
        },
      })
    ).toThrow('File secret provider "nonObject" JSON payload must be an object.');
  });

  it("throws when resolved values are non-string or empty", () => {
    const harness = createHarness();
    harness.files.set(
      "/tmp/cli-tests/.cobuild-cli/secrets.json",
      JSON.stringify(
        {
          token: 123,
          empty: "   ",
        },
        null,
        2
      )
    );

    expect(() =>
      resolveSecretRefString({
        deps: harness.deps,
        config: {},
        ref: defaultFileRef("/token"),
      })
    ).toThrow('Secret reference "file:default:/token" resolved to a non-string or empty value.');
    expect(() =>
      resolveSecretRefString({
        deps: harness.deps,
        config: {},
        ref: defaultFileRef("/empty"),
      })
    ).toThrow('Secret reference "file:default:/empty" resolved to a non-string or empty value.');
  });

  it("uses atomic rename fallback and supports write paths without renameSync", () => {
    const harness = createHarness();
    const originalRename = harness.deps.fs.renameSync;
    let callCount = 0;
    harness.deps.fs.renameSync = (oldPath, newPath) => {
      callCount += 1;
      if (callCount === 1) {
        throw new Error("simulated-rename-failure");
      }
      originalRename?.(oldPath, newPath);
    };

    setSecretRefString({
      deps: harness.deps,
      config: {},
      ref: defaultFileRef("/renameFallback"),
      value: "value-a",
    });
    expect(resolveSecretRefString({ deps: harness.deps, config: {}, ref: defaultFileRef("/renameFallback") })).toBe(
      "value-a"
    );

    harness.deps.fs.renameSync = undefined;
    setSecretRefString({
      deps: harness.deps,
      config: {
        secrets: {
          providers: {
            plain: {
              source: "file",
              path: "/tmp/cli-tests/plain.txt",
              mode: "singleValue",
            },
          },
          defaults: {
            file: "plain",
          },
        },
      },
      ref: {
        source: "file",
        provider: "plain",
        id: SINGLE_VALUE_FILE_REF_ID,
      },
      value: "value-b",
    });
    expect(harness.files.get("/tmp/cli-tests/plain.txt")).toBe("value-b\n");
  });

  it("returns cleanly from delete when refs are unsupported, missing, or malformed", () => {
    const harness = createHarness();

    expect(() =>
      deleteSecretRefString({
        deps: harness.deps,
        config: {},
        ref: {
          source: "env",
          provider: "default",
          id: "COBUILD_PAT",
        },
      })
    ).not.toThrow();

    expect(() =>
      deleteSecretRefString({
        deps: harness.deps,
        config: {},
        ref: defaultFileRef("/missing"),
      })
    ).not.toThrow();

    const brokenPath = "/tmp/cli-tests/.cobuild-cli/secrets.json";
    harness.files.set(brokenPath, "{");
    expect(() =>
      deleteSecretRefString({
        deps: harness.deps,
        config: {},
        ref: defaultFileRef("/token"),
      })
    ).not.toThrow();
    expect(harness.files.get(brokenPath)).toBe("{");
  });

  it("resolves exec providers and validates exec response contracts", () => {
    const harness = createHarness();
    harness.deps.env = {
      PASS_ENV_TOKEN: "pass-value",
    };

    const successScript = [
      'const fs=require("node:fs");',
      'const input=JSON.parse(fs.readFileSync(0,"utf8"));',
      "const id=input.ids[0];",
      'const value=(process.env.PASS_ENV_TOKEN||"")+":"+(process.env.INLINE_ENV||"")+":"+id;',
      "process.stdout.write(JSON.stringify({protocolVersion:1,values:{[id]:value}}));",
    ].join("");

    const successConfig: CliConfig = {
      secrets: {
        providers: {
          execer: {
            source: "exec",
            command: process.execPath,
            args: ["-e", successScript],
            passEnv: ["PASS_ENV_TOKEN"],
            env: {
              INLINE_ENV: "inline-value",
            },
            timeoutMs: 0,
            maxOutputBytes: -1,
          },
        },
      },
    };

    expect(
      resolveSecretRefString({
        deps: harness.deps,
        config: successConfig,
        ref: {
          source: "exec",
          provider: "execer",
          id: "secret-id",
        },
      })
    ).toBe("pass-value:inline-value:secret-id");

    const plainTextConfig = execProviderConfig('process.stdout.write(" plain-secret ");', {
      providers: {
        execer: {
          source: "exec",
          command: process.execPath,
          args: ["-e", 'process.stdout.write(" plain-secret ");'],
          jsonOnly: false,
        },
      },
    });
    expect(
      resolveSecretRefString({
        deps: harness.deps,
        config: plainTextConfig,
        ref: {
          source: "exec",
          provider: "execer",
          id: "plain-id",
        },
      })
    ).toBe("plain-secret");

    expect(() =>
      resolveSecretRefString({
        deps: harness.deps,
        config: {
          secrets: {
            providers: {
              execer: {
                source: "exec",
                command: "node",
                args: ["-e", 'process.stdout.write("{}");'],
              },
            },
          },
        },
        ref: {
          source: "exec",
          provider: "execer",
          id: "id",
        },
      })
    ).toThrow("Exec provider command must be an absolute path");
  });

  it("throws clear errors for invalid exec provider outputs", () => {
    const harness = createHarness();

    const ref: SecretRef = {
      source: "exec",
      provider: "execer",
      id: "secret-id",
    };

    const expectExecError = (script: string, message: string, jsonOnly = true) => {
      const config: CliConfig = {
        secrets: {
          providers: {
            execer: {
              source: "exec",
              command: process.execPath,
              args: ["-e", script],
              jsonOnly,
            },
          },
        },
      };
      expect(() => resolveSecretRefString({ deps: harness.deps, config, ref })).toThrow(message);
    };

    expectExecError("process.exit(2);", 'Exec provider "execer" failed:');
    expectExecError('process.stdout.write("   ");', 'Exec provider "execer" returned empty stdout.');
    expectExecError('process.stdout.write("{");', 'Exec provider "execer" returned invalid JSON.');
    expectExecError("process.stdout.write('123');", 'Exec provider "execer" response must be an object.');
    expectExecError(
      'process.stdout.write(JSON.stringify({protocolVersion:2,values:{}}));',
      'Exec provider "execer" protocolVersion must be 1.'
    );
    expectExecError(
      'process.stdout.write(JSON.stringify({protocolVersion:1}));',
      'Exec provider "execer" response missing "values".'
    );

    expectExecError(
      [
        'const fs=require("node:fs");',
        'const input=JSON.parse(fs.readFileSync(0,"utf8"));',
        "const id=input.ids[0];",
        "const errors={};",
        'errors[id]={message:"boom"};',
        "process.stdout.write(JSON.stringify({protocolVersion:1,values:{},errors}));",
      ].join(""),
      'Exec provider "execer" failed for id "secret-id" (boom).'
    );

    expectExecError(
      [
        'const fs=require("node:fs");',
        'const input=JSON.parse(fs.readFileSync(0,"utf8"));',
        "const id=input.ids[0];",
        "const errors={};",
        "errors[id]={};",
        "process.stdout.write(JSON.stringify({protocolVersion:1,values:{},errors}));",
      ].join(""),
      'Exec provider "execer" failed for id "secret-id".'
    );

    expectExecError(
      'process.stdout.write(JSON.stringify({protocolVersion:1,values:{other:"value"}}));',
      'Exec provider "execer" response missing id "secret-id".'
    );
    expectExecError(
      'process.stdout.write(JSON.stringify({protocolVersion:1,values:{"secret-id":123}}));',
      'Secret reference "exec:execer:secret-id" resolved to a non-string or empty value.'
    );
  });

  it("creates secret refs using configured default aliases", () => {
    expect(
      createSecretRef({
        config: {
          secrets: {
            defaults: {
              env: "env-default",
            },
          },
        },
        source: "env",
        id: "COBUILD_PAT",
      })
    ).toEqual({
      source: "env",
      provider: "env-default",
      id: "COBUILD_PAT",
    });
  });
});
