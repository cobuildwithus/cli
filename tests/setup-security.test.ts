import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";
import { createHarness } from "./helpers.js";

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

describe("setup/config trust-boundary hardening", () => {
  it("setup --link resolves package root from CLI module path and avoids PATH-based pnpm lookup", async () => {
    const harness = createHarness({
      fetchResponder: createJsonResponder({ ok: true, address: "0xabc" }),
    });

    const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "buildbot-setup-security-"));
    const spoofRepo = path.join(tmpRoot, "spoofed-repo");
    mkdirSync(spoofRepo);
    writeFileSync(
      path.join(spoofRepo, "package.json"),
      JSON.stringify({ name: "@cobuildwithus/buildbot" }, null, 2)
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
        ["setup", "--url", "https://api.example", "--token", "bbt_secret", "--link"],
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

  it("setup surfaces BUILD_BOT_URL and BUILD_BOT_NETWORK when they drive interactive defaults", async () => {
    const harness = createHarness({
      config: {
        token: "bbt_secret",
      },
      fetchResponder: createJsonResponder({ ok: true, address: "0xabc" }),
    });
    harness.deps.env = {
      BUILD_BOT_URL: "https://env.example",
      BUILD_BOT_NETWORK: "base",
    };
    harness.deps.isInteractive = () => true;

    await runCli(["setup"], harness.deps);

    expect(harness.outputs).toContain("Using interface URL from BUILD_BOT_URL: https://env.example");
    expect(harness.outputs).toContain("Using default network from BUILD_BOT_NETWORK: base");
    const [, init] = harness.fetchMock.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual({
      agentKey: "default",
      defaultNetwork: "base",
    });
  });

  it("setup fails closed when non-interactive first-time URL comes only from BUILD_BOT_URL", async () => {
    const harness = createHarness({
      config: {
        token: "bbt_secret",
      },
    });
    harness.deps.env = {
      BUILD_BOT_URL: "https://env.example",
    };
    harness.deps.isInteractive = () => false;

    await expect(runCli(["setup"], harness.deps)).rejects.toThrow(
      "BUILD_BOT_URL came from environment for first-time setup. Pass --url explicitly to trust it."
    );
    expect(harness.fetchMock).not.toHaveBeenCalled();
  });

  it("setup rejects non-loopback http interface URLs", async () => {
    const harness = createHarness({
      fetchResponder: createJsonResponder({ ok: true, address: "0xabc" }),
    });

    await expect(
      runCli(["setup", "--url", "http://api.example", "--token", "bbt_secret"], harness.deps)
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
      runCli(["setup", "--url", "https://user:pass@api.example", "--token", "bbt_secret"], harness.deps)
    ).rejects.toThrow("Interface URL must not include username or password.");
    expect(harness.fetchMock).not.toHaveBeenCalled();
  });

  it("setup accepts token via --token-stdin for non-interactive use", async () => {
    const harness = createHarness({
      fetchResponder: createJsonResponder({ ok: true, address: "0xabc" }),
    });
    harness.deps.readStdin = async () => "bbt_from_stdin\n";

    await runCli(["setup", "--url", "https://api.example", "--token-stdin"], harness.deps);

    expect(JSON.parse(harness.files.get(harness.configFile) ?? "{}")).toEqual({
      url: "https://api.example",
      token: "bbt_from_stdin",
      agent: "default",
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
    const tokenFile = "/tmp/buildbot-setup-token.txt";
    harness.files.set(tokenFile, "bbt_from_file\n");

    await runCli(["setup", "--url", "https://api.example", "--token-file", tokenFile], harness.deps);

    expect(JSON.parse(harness.files.get(harness.configFile) ?? "{}")).toEqual({
      url: "https://api.example",
      token: "bbt_from_file",
      agent: "default",
    });
    const [, init] = harness.fetchMock.mock.calls[0];
    expect(init?.headers).toMatchObject({
      authorization: "Bearer bbt_from_file",
    });
  });

  it("setup rejects multiple token input sources", async () => {
    const harness = createHarness();

    await expect(
      runCli(
        ["setup", "--url", "https://api.example", "--token", "bbt_a", "--token-file", "/tmp/token.txt"],
        harness.deps
      )
    ).rejects.toThrow("Provide only one of --token, --token-file, or --token-stdin.");
    expect(harness.fetchMock).not.toHaveBeenCalled();
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
      ["setup", "--url", "https://api.example", "--token", "bbt_secret", "--link"],
      harness.deps
    );

    expect(linkCalls).toEqual([]);
    expect(harness.outputs).toContain(
      "Auto-link skipped: unable to locate a trusted pnpm entrypoint for this shell session. Run manually: pnpm link --global"
    );
  });

  it("config set accepts token via --token-file", async () => {
    const harness = createHarness();
    const tokenFile = "/tmp/buildbot-token.txt";
    harness.files.set(tokenFile, "bbt_from_file\n");

    await runCli(["config", "set", "--token-file", tokenFile], harness.deps);
    await runCli(["config", "show"], harness.deps);

    expect(parseLastJsonOutput(harness.outputs)).toEqual({
      url: null,
      token: "bbt_from...",
      agent: null,
      path: harness.configFile,
    });
  });

  it("config set accepts token via --token-stdin", async () => {
    const harness = createHarness();
    harness.deps.readStdin = async () => "bbt_from_stdin\n";

    await runCli(["config", "set", "--token-stdin"], harness.deps);
    await runCli(["config", "show"], harness.deps);

    expect(parseLastJsonOutput(harness.outputs)).toEqual({
      url: null,
      token: "bbt_from...",
      agent: null,
      path: harness.configFile,
    });
  });

  it("config set rejects empty token file content", async () => {
    const harness = createHarness();
    const tokenFile = "/tmp/buildbot-empty-token.txt";
    harness.files.set(tokenFile, "   \n");

    await expect(runCli(["config", "set", "--token-file", tokenFile], harness.deps)).rejects.toThrow(
      `Token file is empty: ${tokenFile}`
    );
  });

  it("config set rejects unreadable token files", async () => {
    const harness = createHarness();
    const missingTokenFile = "/tmp/buildbot-missing-token.txt";

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
    ).rejects.toThrow("Provide only one of --token, --token-file, or --token-stdin.");
  });
});
