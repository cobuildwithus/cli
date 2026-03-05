import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";
import { DEFAULT_CHAT_API_URL, DEFAULT_INTERFACE_URL } from "../src/config.js";
import { createHarness } from "./helpers.js";

function expectedDefaultSecretsConfig() {
  return {
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
  } as const;
}

function expectedRefreshTokenRef(interfaceUrl: string | null) {
  if (!interfaceUrl) {
    return {
      source: "file",
      provider: "default",
      id: "/oauth_refresh:default",
    } as const;
  }
  const origin = new URL(interfaceUrl).origin;
  const encoded = origin.replaceAll("~", "~0").replaceAll("/", "~1");
  return {
    source: "file",
    provider: "default",
    id: `/oauth_refresh:${encoded}`,
  } as const;
}

function createJsonResponder(body: unknown, status = 200) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  });
}

function parseLastJsonOutput(outputs: string[]): unknown {
  return JSON.parse(outputs.at(-1) ?? "null");
}

function overrideIsTty(stream: object, value: boolean): () => void {
  const target = stream as { isTTY?: boolean };
  const hadOwnProperty = Object.prototype.hasOwnProperty.call(target, "isTTY");
  const previousValue = target.isTTY;
  Object.defineProperty(target, "isTTY", {
    value,
    configurable: true,
  });
  return () => {
    if (hadOwnProperty) {
      Object.defineProperty(target, "isTTY", {
        value: previousValue,
        configurable: true,
      });
      return;
    }
    delete target.isTTY;
  };
}

describe("setup/config trust-boundary hardening", () => {
  it("setup --link resolves package root from CLI module path and avoids PATH-based pnpm lookup", async () => {
    const harness = createHarness({
      fetchResponder: createJsonResponder({ ok: true, address: "0xabc" }),
    });

    const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "cli-setup-security-"));
    const spoofRepo = path.join(tmpRoot, "spoofed-repo");
    mkdirSync(spoofRepo);
    writeFileSync(
      path.join(spoofRepo, "package.json"),
      JSON.stringify({ name: "@cobuild/cli" }, null, 2)
    );

    const fakePnpmExecPath = path.join(tmpRoot, "pnpm.cjs");
    writeFileSync(fakePnpmExecPath, "console.log('fake pnpm')");

    const linkCalls: Array<{ cwd: string; command: string; args: string[] }> = [];
    harness.deps.env = { npm_execpath: fakePnpmExecPath };
    harness.deps.runSetupLinkGlobal = async (params) => {
      linkCalls.push(params);
      return { ok: true, output: "" };
    };

    const previousCwd = process.cwd();
    try {
      process.chdir(spoofRepo);
      await runCli(
        ["setup", "--url", "https://api.example", "--token", "bbt_secret", "--wallet-mode", "hosted", "--link"],
        harness.deps
      );
    } finally {
      process.chdir(previousCwd);
      rmSync(tmpRoot, { recursive: true, force: true });
    }

    const expectedPackageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    expect(linkCalls).toEqual([
      {
        cwd: expectedPackageRoot,
        command: process.execPath,
        args: [fakePnpmExecPath, "link", "--global"],
      },
    ]);
  });

  it("setup surfaces COBUILD_CLI_URL and COBUILD_CLI_NETWORK when they drive interactive defaults", async () => {
    const harness = createHarness({
      config: {
        token: "bbt_secret",
      },
      fetchResponder: createJsonResponder({ ok: true, address: "0xabc" }),
    });
    harness.deps.env = {
      COBUILD_CLI_URL: "https://env.example",
      COBUILD_CLI_NETWORK: "base",
    };
    harness.deps.isInteractive = () => true;

    await runCli(["setup", "--wallet-mode", "hosted"], harness.deps);

    expect(harness.errors).toContain("Using interface URL from COBUILD_CLI_URL: https://env.example");
    expect(harness.errors).toContain("Using default network from COBUILD_CLI_NETWORK: base");
    const [, init] = harness.fetchMock.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual({
      agentKey: "default",
      defaultNetwork: "base",
    });
  });

  it("setup fallback interactivity uses stderr TTY even when stdout is not a TTY", async () => {
    const harness = createHarness({
      fetchResponder: createJsonResponder({ ok: true, address: "0xabc" }),
    });

    const restoreStdin = overrideIsTty(process.stdin, true);
    const restoreStdout = overrideIsTty(process.stdout, false);
    const restoreStderr = overrideIsTty(process.stderr, true);
    try {
      await runCli(
        ["setup", "--url", "https://api.example", "--token", "bbt_secret", "--wallet-mode", "hosted"],
        harness.deps
      );
    } finally {
      restoreStderr();
      restoreStdout();
      restoreStdin();
    }

    expect(harness.errors).toContain("CLI Setup Wizard");
  });

  it("setup ignores deprecated COBUILD_CLI_CHAT_API_URL environment input", async () => {
    const harness = createHarness({
      config: {
        token: "bbt_secret",
      },
      fetchResponder: createJsonResponder({ ok: true, address: "0xabc" }),
    });
    harness.deps.env = {
      COBUILD_CLI_CHAT_API_URL: "https://env-chat.example",
    };
    harness.deps.isInteractive = () => false;

    await runCli(["setup", "--url", "https://interface.example", "--wallet-mode", "hosted"], harness.deps);
    expect(harness.fetchMock).toHaveBeenCalledTimes(2);

    expect(JSON.parse(harness.files.get(harness.configFile) ?? "{}")).toEqual({
      url: "https://interface.example",
      chatApiUrl: DEFAULT_CHAT_API_URL,
      agent: "default",
      auth: {
        tokenRef: expectedRefreshTokenRef("https://interface.example"),
      },
      secrets: expectedDefaultSecretsConfig(),
    });
  });

  it("setup fails closed when non-interactive first-time URL comes only from COBUILD_CLI_URL", async () => {
    const harness = createHarness({
      config: {
        token: "bbt_secret",
      },
    });
    harness.deps.env = {
      COBUILD_CLI_URL: "https://env.example",
    };
    harness.deps.isInteractive = () => false;

    await expect(runCli(["setup", "--wallet-mode", "hosted"], harness.deps)).rejects.toThrow(
      "COBUILD_CLI_URL came from environment for first-time setup. Pass --url explicitly to trust it."
    );
    expect(harness.fetchMock).not.toHaveBeenCalled();
  });

  it("setup rejects non-loopback http interface URLs", async () => {
    const harness = createHarness({
      fetchResponder: createJsonResponder({ ok: true, address: "0xabc" }),
    });

    await expect(
      runCli(
        ["setup", "--url", "http://api.example", "--token", "bbt_secret", "--wallet-mode", "hosted"],
        harness.deps
      )
    ).rejects.toThrow(
      "Interface URL must use https (http is allowed only for localhost, 127.0.0.1, or [::1])."
    );
    expect(harness.fetchMock).not.toHaveBeenCalled();
  });

  it("setup rejects interface URLs with embedded credentials", async () => {
    const harness = createHarness({
      fetchResponder: createJsonResponder({ ok: true, address: "0xabc" }),
    });

    await expect(
      runCli(
        ["setup", "--url", "https://user:pass@api.example", "--token", "bbt_secret", "--wallet-mode", "hosted"],
        harness.deps
      )
    ).rejects.toThrow("Interface URL must not include username or password.");
    expect(harness.fetchMock).not.toHaveBeenCalled();
  });

  it("setup accepts token via --token-stdin for non-interactive use", async () => {
    const harness = createHarness({
      fetchResponder: createJsonResponder({ ok: true, address: "0xabc" }),
    });
    harness.deps.readStdin = async () => "bbt_from_stdin\n";

    await runCli(
      ["setup", "--url", "https://api.example", "--token-stdin", "--wallet-mode", "hosted"],
      harness.deps
    );

    expect(JSON.parse(harness.files.get(harness.configFile) ?? "{}")).toEqual({
      url: "https://api.example",
      chatApiUrl: DEFAULT_CHAT_API_URL,
      agent: "default",
      auth: {
        tokenRef: expectedRefreshTokenRef("https://api.example"),
      },
      secrets: expectedDefaultSecretsConfig(),
    });
    const [, init] = harness.fetchMock.mock.calls[0];
    expect(init?.headers).toMatchObject({
      authorization: "Bearer bbt_from_stdin",
    });
  });

  it("setup accepts token via --token-file for non-interactive use", async () => {
    const harness = createHarness({
      fetchResponder: createJsonResponder({ ok: true, address: "0xabc" }),
    });
    const tokenFile = "/tmp/cli-setup-token.txt";
    harness.files.set(tokenFile, "bbt_from_file\n");

    await runCli(
      ["setup", "--url", "https://api.example", "--token-file", tokenFile, "--wallet-mode", "hosted"],
      harness.deps
    );

    expect(JSON.parse(harness.files.get(harness.configFile) ?? "{}")).toEqual({
      url: "https://api.example",
      chatApiUrl: DEFAULT_CHAT_API_URL,
      agent: "default",
      auth: {
        tokenRef: expectedRefreshTokenRef("https://api.example"),
      },
      secrets: expectedDefaultSecretsConfig(),
    });
    const [, init] = harness.fetchMock.mock.calls[0];
    expect(init?.headers).toMatchObject({
      authorization: "Bearer bbt_from_file",
    });
  });

  it("setup preserves auth-failure messaging when token cleanup write fails", async () => {
    const harness = createHarness({
      fetchResponder: createJsonResponder(
        {
          ok: false,
          error: "unauthorized",
        },
        401
      ),
    });

    let renameCount = 0;
    const originalRename = harness.deps.fs.renameSync;
    harness.deps.fs.renameSync = (oldPath, newPath) => {
      if (newPath === harness.configFile) {
        renameCount += 1;
        if (renameCount >= 2) {
          throw new Error("EIO: simulated cleanup rename failure");
        }
      }
      originalRename?.(oldPath, newPath);
    };

    await expect(
      runCli(
        ["setup", "--url", "https://api.example", "--token", "bbt_secret", "--wallet-mode", "hosted"],
        harness.deps
      )
    ).rejects.toThrow(
      "OAuth authorization failed while bootstrapping wallet access. Token cleanup may have failed; remove persisted credentials manually before retrying setup."
    );
  });

  it("setup reuses persisted tokenRef values in non-interactive mode", async () => {
    const secretsPath = "/tmp/cli-tests/.cobuild-cli/secrets.json";
    const harness = createHarness({
      config: {
        url: "https://api.example",
        agent: "default",
        auth: {
          tokenRef: expectedRefreshTokenRef("https://api.example"),
        },
        secrets: expectedDefaultSecretsConfig(),
      },
      fetchResponder: createJsonResponder({ ok: true, address: "0xabc" }),
    });
    harness.deps.isInteractive = () => false;
    harness.files.set(
      secretsPath,
      JSON.stringify(
        {
          "oauth_refresh:https://api.example": "bbt_saved_secret",
        },
        null,
        2
      )
    );

    await runCli(["setup", "--url", "https://api.example", "--wallet-mode", "hosted"], harness.deps);

    const [, init] = harness.fetchMock.mock.calls[0];
    expect(init?.headers).toMatchObject({
      authorization: "Bearer bbt_saved_secret",
    });
  });

  it("setup honors explicit --token when stored tokenRef cannot be resolved", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        agent: "default",
        auth: {
          tokenRef: {
            source: "env",
            provider: "default",
            id: "MISSING_STORED_PAT",
          },
        },
      },
      fetchResponder: createJsonResponder({ ok: true, address: "0xabc" }),
    });

    await runCli(
      ["setup", "--url", "https://api.example", "--token", "bbt_override", "--wallet-mode", "hosted"],
      harness.deps
    );

    const [, init] = harness.fetchMock.mock.calls[0];
    expect(init?.headers).toMatchObject({
      authorization: "Bearer bbt_override",
    });
  });

  it("setup surfaces stored tokenRef resolution errors in non-interactive mode without token override", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        agent: "default",
        auth: {
          tokenRef: {
            source: "env",
            provider: "default",
            id: "MISSING_STORED_PAT",
          },
        },
      },
    });
    harness.deps.isInteractive = () => false;

    await expect(
      runCli(["setup", "--url", "https://api.example", "--wallet-mode", "hosted"], harness.deps)
    ).rejects.toThrow(
      'Environment variable "MISSING_STORED_PAT" is missing or empty.'
    );
  });

  it("setup rejects multiple token input sources", async () => {
    const harness = createHarness();

    await expect(
      runCli(
        [
          "setup",
          "--url",
          "https://api.example",
          "--token",
          "bbt_a",
          "--token-file",
          "/tmp/token.txt",
          "--wallet-mode",
          "hosted",
        ],
        harness.deps
      )
    ).rejects.toThrow("Provide only one of --token, --token-file, or --token-stdin.");
    expect(harness.fetchMock).not.toHaveBeenCalled();
  });

  it("setup rejects payer private key sources without --wallet-mode local-key", async () => {
    const harness = createHarness();

    await expect(
      runCli(
        [
          "setup",
          "--url",
          "https://api.example",
          "--token",
          "bbt_a",
          "--wallet-mode",
          "hosted",
          "--wallet-private-key-stdin",
        ],
        harness.deps
      )
    ).rejects.toThrow("--wallet-private-key-stdin/--wallet-private-key-file require --wallet-mode local-key.");
  });

  it("setup rejects multiple payer private key input sources", async () => {
    const harness = createHarness();

    await expect(
      runCli(
        [
          "setup",
          "--url",
          "https://api.example",
          "--token",
          "bbt_a",
          "--wallet-mode",
          "local-key",
          "--wallet-private-key-stdin",
          "--wallet-private-key-file",
          "/tmp/key.txt",
        ],
        harness.deps
      )
    ).rejects.toThrow("Provide only one of --wallet-private-key-stdin or --wallet-private-key-file.");
  });

  it("setup rejects local-key mode without a key source in non-interactive mode", async () => {
    const harness = createHarness();
    harness.deps.isInteractive = () => false;

    await expect(
      runCli(
        ["setup", "--url", "https://api.example", "--token", "bbt_a", "--wallet-mode", "local-key"],
        harness.deps
      )
    ).rejects.toThrow(
      "--wallet-mode local-key requires --wallet-private-key-stdin or --wallet-private-key-file in non-interactive mode."
    );
    expect(harness.fetchMock).not.toHaveBeenCalled();
  });

  it("setup pre-validates payer private key files before wallet bootstrap", async () => {
    const harness = createHarness();

    await expect(
      runCli(
        [
          "setup",
          "--url",
          "https://api.example",
          "--token",
          "bbt_a",
          "--wallet-mode",
          "local-key",
          "--wallet-private-key-file",
          "/tmp/missing-x402.key",
        ],
        harness.deps
      )
    ).rejects.toThrow("Could not read wallet private key file: /tmp/missing-x402.key");
    expect(harness.fetchMock).not.toHaveBeenCalled();
  });

  it("setup validates --agent before any config write or wallet bootstrap side effects", async () => {
    const harness = createHarness({
      config: {
        url: "https://existing.example",
        chatApiUrl: "https://chat.existing.example",
        token: "bbt_existing",
        agent: "existing-agent",
      },
    });
    const beforeConfig = harness.files.get(harness.configFile);

    await expect(
      runCli(
        [
          "setup",
          "--url",
          "https://api.example",
          "--token",
          "bbt_a",
          "--wallet-mode",
          "hosted",
          "--agent",
          "..",
        ],
        harness.deps
      )
    ).rejects.toThrow('agent key must not be "." or "..".');

    expect(harness.fetchMock).not.toHaveBeenCalled();
    expect(harness.files.get(harness.configFile)).toBe(beforeConfig);
  });

  it("setup validates --agent before resolving exec-backed stored refresh token refs", async () => {
    const harness = createHarness({
      config: {
        url: "https://existing.example",
        auth: {
          tokenRef: {
            source: "exec",
            provider: "exec1",
            id: "refresh-token",
          },
        },
        secrets: {
          providers: {
            exec1: {
              source: "exec",
              command: "/tmp/missing-secret-provider",
            },
          },
          defaults: {
            exec: "exec1",
          },
        },
      },
    });
    harness.deps.isInteractive = () => false;

    await expect(
      runCli(
        [
          "setup",
          "--url",
          "https://api.example",
          "--wallet-mode",
          "hosted",
          "--agent",
          "..",
        ],
        harness.deps
      )
    ).rejects.toThrow('agent key must not be "." or "..".');
  });

  it("setup --link skips auto-link when npm_execpath is not a trusted pnpm entrypoint", async () => {
    const harness = createHarness({
      fetchResponder: createJsonResponder({ ok: true, address: "0xabc" }),
    });
    const linkCalls: Array<{ cwd: string; command: string; args: string[] }> = [];
    harness.deps.env = {
      npm_execpath: "/tmp/not-pnpm.js",
    };
    harness.deps.runSetupLinkGlobal = async (params) => {
      linkCalls.push(params);
      return { ok: true, output: "" };
    };

    await runCli(
      ["setup", "--url", "https://api.example", "--token", "bbt_secret", "--wallet-mode", "hosted", "--link"],
      harness.deps
    );

    expect(linkCalls).toEqual([]);
    expect(harness.errors).toContain(
      "Auto-link skipped: unable to locate a trusted pnpm entrypoint for this shell session. Run manually: pnpm link --global"
    );
  });

  it("config set rejects token via --token-file when no interface URL is configured yet", async () => {
    const harness = createHarness();
    const tokenFile = "/tmp/cli-token.txt";
    harness.files.set(tokenFile, "bbt_from_file\n");

    await expect(runCli(["config", "set", "--token-file", tokenFile], harness.deps)).rejects.toThrow(
      "Pass --url the first time you set a token so it can be bound to the correct interface origin."
    );
  });

  it("config set accepts token via --token-file when interface URL already exists", async () => {
    const harness = createHarness({
      config: {
        url: DEFAULT_INTERFACE_URL,
      },
    });
    const tokenFile = "/tmp/cli-token.txt";
    harness.files.set(tokenFile, "bbt_from_file\n");

    await runCli(["config", "set", "--token-file", tokenFile], harness.deps);
    expect(JSON.parse(harness.files.get(harness.configFile) ?? "{}")).toEqual({
      url: DEFAULT_INTERFACE_URL,
      chatApiUrl: DEFAULT_INTERFACE_URL,
      auth: {
        tokenRef: expectedRefreshTokenRef(DEFAULT_INTERFACE_URL),
      },
      secrets: expectedDefaultSecretsConfig(),
    });
    await runCli(["config", "show"], harness.deps);

    expect(parseLastJsonOutput(harness.outputs)).toEqual({
      interfaceUrl: DEFAULT_INTERFACE_URL,
      chatApiUrl: DEFAULT_INTERFACE_URL,
      token: "bbt_from...",
      tokenRef: expectedRefreshTokenRef(DEFAULT_INTERFACE_URL),
      agent: null,
      path: harness.configFile,
    });
  });

  it("config set rejects token via --token-stdin when no interface URL is configured yet", async () => {
    const harness = createHarness();
    harness.deps.readStdin = async () => "bbt_from_stdin\n";

    await expect(runCli(["config", "set", "--token-stdin"], harness.deps)).rejects.toThrow(
      "Pass --url the first time you set a token so it can be bound to the correct interface origin."
    );
  });

  it("config set accepts token via --token-stdin when interface URL already exists", async () => {
    const harness = createHarness({
      config: {
        url: DEFAULT_INTERFACE_URL,
      },
    });
    harness.deps.readStdin = async () => "bbt_from_stdin\n";

    await runCli(["config", "set", "--token-stdin"], harness.deps);
    expect(JSON.parse(harness.files.get(harness.configFile) ?? "{}")).toEqual({
      url: DEFAULT_INTERFACE_URL,
      chatApiUrl: DEFAULT_INTERFACE_URL,
      auth: {
        tokenRef: expectedRefreshTokenRef(DEFAULT_INTERFACE_URL),
      },
      secrets: expectedDefaultSecretsConfig(),
    });
    await runCli(["config", "show"], harness.deps);

    expect(parseLastJsonOutput(harness.outputs)).toEqual({
      interfaceUrl: DEFAULT_INTERFACE_URL,
      chatApiUrl: DEFAULT_INTERFACE_URL,
      token: "bbt_from...",
      tokenRef: expectedRefreshTokenRef(DEFAULT_INTERFACE_URL),
      agent: null,
      path: harness.configFile,
    });
  });

  it("config set rejects empty token file content", async () => {
    const harness = createHarness();
    const tokenFile = "/tmp/cli-empty-token.txt";
    harness.files.set(tokenFile, "   \n");

    await expect(runCli(["config", "set", "--token-file", tokenFile], harness.deps)).rejects.toThrow(
      `Token file is empty: ${tokenFile}`
    );
  });

  it("config set rejects unreadable token files", async () => {
    const harness = createHarness();
    const missingTokenFile = "/tmp/cli-missing-token.txt";

    await expect(
      runCli(["config", "set", "--token-file", missingTokenFile], harness.deps)
    ).rejects.toThrow(`Could not read token file: ${missingTokenFile}`);
  });

  it("config set rejects empty token from --token-stdin", async () => {
    const harness = createHarness();
    harness.deps.readStdin = async () => " \n";

    await expect(runCli(["config", "set", "--token-stdin"], harness.deps)).rejects.toThrow(
      "Token stdin input is empty."
    );
  });

  it("config set rejects empty --token values", async () => {
    const harness = createHarness();

    await expect(runCli(["config", "set", "--token", ""], harness.deps)).rejects.toThrow(
      "Token cannot be empty"
    );
  });

  it("config set rejects multiple token input sources", async () => {
    const harness = createHarness();
    await expect(
      runCli(["config", "set", "--token", "bbt_a", "--token-stdin"], harness.deps)
    ).rejects.toThrow(
      "Provide only one token source: --token, --token-file, --token-stdin, --token-env, --token-exec, or --token-ref-json."
    );
  });
});
