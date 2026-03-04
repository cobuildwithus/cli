import { describe, expect, it, vi } from "vitest";
import * as cliIncur from "../src/cli-incur.js";
import { runCli } from "../src/cli.js";
import { createHarness } from "./helpers.js";

const POSITIONAL_ESCAPE_PREFIX = "__incur_positional_b64__";

function encodeEscapedPositional(value: string): string {
  return `${POSITIONAL_ESCAPE_PREFIX}${Buffer.from(value, "utf8").toString("base64url")}`;
}

describe("cli runtime coverage", () => {
  it("returns cleanly when the Incur runtime exits with code 0 and flushes output", async () => {
    const harness = createHarness();
    const preprocessSpy = vi.spyOn(cliIncur, "preprocessIncurArgv").mockImplementation((argv) => argv);
    const createSpy = vi.spyOn(cliIncur, "createCobuildIncurCli").mockReturnValue({
      async serve(_argv: string[], options?: { stdout?: (chunk: string) => void; exit?: (code: number) => void }) {
        options?.stdout?.('{"ok":true}\n');
        options?.exit?.(0);
      },
    } as unknown as ReturnType<typeof cliIncur.createCobuildIncurCli>);

    await runCli(["wallet"], harness.deps);

    expect(harness.outputs).toEqual(['{"ok":true}']);
    expect(preprocessSpy).toHaveBeenCalledWith(["wallet"]);
    expect(createSpy).toHaveBeenCalled();
    preprocessSpy.mockRestore();
    createSpy.mockRestore();
  });

  it("preserves blank lines and normalizes CRLF when buffering stdout", async () => {
    const harness = createHarness();
    const preprocessSpy = vi.spyOn(cliIncur, "preprocessIncurArgv").mockImplementation((argv) => argv);
    const createSpy = vi.spyOn(cliIncur, "createCobuildIncurCli").mockReturnValue({
      async serve(_argv: string[], options?: { stdout?: (chunk: string) => void; exit?: (code: number) => void }) {
        options?.stdout?.('{"ok":true}\r\n');
        options?.stdout?.("\n");
        options?.stdout?.("line-two\r\n");
        options?.exit?.(0);
      },
    } as unknown as ReturnType<typeof cliIncur.createCobuildIncurCli>);

    await runCli(["wallet"], harness.deps);

    expect(harness.outputs).toEqual(['{"ok":true}', "", "line-two"]);
    preprocessSpy.mockRestore();
    createSpy.mockRestore();
  });

  it("collapses docs and tools multi-word positionals during Incur preprocessing", () => {
    expect(
      cliIncur.preprocessIncurArgv(["docs", "--limit", "5", "how", "to", "send", "usdc"])
    ).toEqual(["docs", "--limit", "5", encodeEscapedPositional("how to send usdc")]);

    expect(
      cliIncur.preprocessIncurArgv(["docs", "--", "--token-stdin", "usage"])
    ).toEqual(["docs", encodeEscapedPositional("--token-stdin usage")]);

    expect(
      cliIncur.preprocessIncurArgv(["tools", "get-user", "alice", "builder"])
    ).toEqual(["tools", "get-user", encodeEscapedPositional("alice builder")]);

    expect(
      cliIncur.preprocessIncurArgv(["tools", "get-cast", "hello", "world", "--type", "url"])
    ).toEqual(["tools", "get-cast", "--type", "url", encodeEscapedPositional("hello world")]);
  });

  it("normalizes preprocessing when global flags appear before the command", () => {
    expect(
      cliIncur.preprocessIncurArgv(["--verbose", "docs", "how", "to", "send", "usdc"])
    ).toEqual(["--verbose", "docs", encodeEscapedPositional("how to send usdc")]);

    expect(
      cliIncur.preprocessIncurArgv(["--json", "farcaster", "post", "--verify"])
    ).toEqual(["--json", "farcaster", "post", "--verify=once"]);
  });

  it("does not rewrite legacy farcaster payer command paths after hard cutover", () => {
    expect(cliIncur.preprocessIncurArgv(["farcaster", "payer", "status"])).toEqual([
      "farcaster",
      "payer",
      "status",
    ]);
  });

  it("treats leading --json as setup machine-mode when command is setup", () => {
    expect(
      cliIncur.preprocessIncurArgv(["--json", "setup", "--url", "https://api.example"])
    ).toEqual(["setup", "--setup-json", "--url", "https://api.example"]);
  });

  it("rethrows unexpected runtime errors from serve", async () => {
    const harness = createHarness();
    const preprocessSpy = vi.spyOn(cliIncur, "preprocessIncurArgv").mockImplementation((argv) => argv);
    const createSpy = vi.spyOn(cliIncur, "createCobuildIncurCli").mockReturnValue({
      async serve() {
        throw new Error("boom");
      },
    } as unknown as ReturnType<typeof cliIncur.createCobuildIncurCli>);

    await expect(runCli(["wallet"], harness.deps)).rejects.toThrow("boom");

    preprocessSpy.mockRestore();
    createSpy.mockRestore();
  });

  it("extracts error messages from mixed output shapes", async () => {
    const harness = createHarness();
    const preprocessSpy = vi.spyOn(cliIncur, "preprocessIncurArgv").mockImplementation((argv) => argv);

    const createSpy = vi.spyOn(cliIncur, "createCobuildIncurCli");

    createSpy.mockReturnValueOnce({
      async serve(_argv: string[], options?: { stdout?: (chunk: string) => void; exit?: (code: number) => void }) {
        options?.stdout?.("prefix line\n");
        options?.stdout?.('{\"message\":\"parsed from final json line\"}\n');
        options?.exit?.(1);
      },
    } as unknown as ReturnType<typeof cliIncur.createCobuildIncurCli>);
    await expect(runCli(["wallet"], harness.deps)).rejects.toThrow("parsed from final json line");

    createSpy.mockReturnValueOnce({
      async serve(_argv: string[], options?: { stdout?: (chunk: string) => void; exit?: (code: number) => void }) {
        options?.stdout?.('{\"error\":{\"message\":\"nested error payload\"}}\n');
        options?.exit?.(1);
      },
    } as unknown as ReturnType<typeof cliIncur.createCobuildIncurCli>);
    await expect(runCli(["wallet"], harness.deps)).rejects.toThrow("nested error payload");

    createSpy.mockReturnValueOnce({
      async serve(_argv: string[], options?: { stdout?: (chunk: string) => void; exit?: (code: number) => void }) {
        options?.stdout?.("Error (AUTH): denied\n");
        options?.exit?.(1);
      },
    } as unknown as ReturnType<typeof cliIncur.createCobuildIncurCli>);
    await expect(runCli(["wallet"], harness.deps)).rejects.toThrow("denied");

    createSpy.mockReturnValueOnce({
      async serve(_argv: string[], options?: { stdout?: (chunk: string) => void; exit?: (code: number) => void }) {
        options?.stdout?.("raw failure text\n");
        options?.exit?.(1);
      },
    } as unknown as ReturnType<typeof cliIncur.createCobuildIncurCli>);
    await expect(runCli(["wallet"], harness.deps)).rejects.toThrow("raw failure text");

    createSpy.mockReturnValueOnce({
      async serve(_argv: string[], options?: { stdout?: (chunk: string) => void; exit?: (code: number) => void }) {
        options?.stdout?.("{\"ok\":false}\n");
        options?.exit?.(1);
      },
    } as unknown as ReturnType<typeof cliIncur.createCobuildIncurCli>);
    await expect(runCli(["wallet"], harness.deps)).rejects.toThrow("{\"ok\":false}");
    expect(harness.outputs).toEqual([]);

    preprocessSpy.mockRestore();
    createSpy.mockRestore();
  });

  it("normalizes unknown command errors across legacy and current Incur text", async () => {
    const harness = createHarness();
    const preprocessSpy = vi.spyOn(cliIncur, "preprocessIncurArgv").mockImplementation((argv) => argv);
    const createSpy = vi.spyOn(cliIncur, "createCobuildIncurCli");

    createSpy.mockReturnValueOnce({
      async serve(_argv: string[], options?: { stdout?: (chunk: string) => void; exit?: (code: number) => void }) {
        options?.stdout?.(
          "'unknown' is not a command. See 'cli --help' for a list of available commands.\n"
        );
        options?.exit?.(1);
      },
    } as unknown as ReturnType<typeof cliIncur.createCobuildIncurCli>);
    await expect(runCli(["unknown"], harness.deps)).rejects.toThrow("Unknown command: unknown");

    createSpy.mockReturnValueOnce({
      async serve(_argv: string[], options?: { stdout?: (chunk: string) => void; exit?: (code: number) => void }) {
        options?.stdout?.(
          "'delete' is not a command. See 'cli config --help' for a list of available commands.\n"
        );
        options?.exit?.(1);
      },
    } as unknown as ReturnType<typeof cliIncur.createCobuildIncurCli>);
    await expect(runCli(["config", "delete"], harness.deps)).rejects.toThrow(
      "Unknown config subcommand: delete"
    );

    createSpy.mockReturnValueOnce({
      async serve(_argv: string[], options?: { stdout?: (chunk: string) => void; exit?: (code: number) => void }) {
        options?.stdout?.("'nope' is not a command for 'cli'.\n");
        options?.exit?.(1);
      },
    } as unknown as ReturnType<typeof cliIncur.createCobuildIncurCli>);
    await expect(runCli(["nope"], harness.deps)).rejects.toThrow("Unknown command: nope");

    createSpy.mockReturnValueOnce({
      async serve(_argv: string[], options?: { stdout?: (chunk: string) => void; exit?: (code: number) => void }) {
        options?.stdout?.('{\"error\":{\"message\":\"\'prune\' is not a command for \'cli wallet\'.\"}}\n');
        options?.exit?.(1);
      },
    } as unknown as ReturnType<typeof cliIncur.createCobuildIncurCli>);
    await expect(runCli(["wallet", "prune"], harness.deps)).rejects.toThrow(
      "Unknown wallet subcommand: prune"
    );
    expect(harness.outputs).toEqual([]);

    preprocessSpy.mockRestore();
    createSpy.mockRestore();
  });

  it("marks --mcp mode and skips stdout buffering adapter", async () => {
    const harness = createHarness();
    const preprocessSpy = vi.spyOn(cliIncur, "preprocessIncurArgv").mockImplementation((argv) => argv);
    const createSpy = vi.spyOn(cliIncur, "createCobuildIncurCli").mockReturnValue({
      async serve() {
        return;
      },
    } as unknown as ReturnType<typeof cliIncur.createCobuildIncurCli>);

    await runCli(["--mcp"], harness.deps);

    expect(preprocessSpy).toHaveBeenCalledWith(["--mcp"]);
    expect(createSpy).toHaveBeenCalledWith(expect.objectContaining(harness.deps), { mcpMode: true });
    const mcpDeps = createSpy.mock.calls[0]?.[0] as {
      isInteractive?: () => boolean;
      readStdin?: () => Promise<string>;
    };
    expect(mcpDeps.isInteractive?.()).toBe(false);
    await expect(mcpDeps.readStdin!()).rejects.toThrow(
      "stdin is reserved for MCP; use explicit flags or file options instead of --*-stdin."
    );
    expect(harness.outputs).toEqual([]);

    preprocessSpy.mockRestore();
    createSpy.mockRestore();
  });

  it("does not treat positional '--mcp' as MCP runtime mode", async () => {
    const harness = createHarness();
    const preprocessSpy = vi.spyOn(cliIncur, "preprocessIncurArgv").mockImplementation((argv) => argv);
    const createSpy = vi.spyOn(cliIncur, "createCobuildIncurCli").mockReturnValue({
      async serve(_argv: string[], options?: { stdout?: (chunk: string) => void }) {
        options?.stdout?.("{\"ok\":true}\n");
      },
    } as unknown as ReturnType<typeof cliIncur.createCobuildIncurCli>);

    await runCli(["docs", "--", "--mcp"], harness.deps);

    expect(preprocessSpy).toHaveBeenCalledWith(["docs", "--", "--mcp"]);
    expect(createSpy).toHaveBeenCalledWith(harness.deps, { mcpMode: false });
    expect(harness.outputs).toEqual(['{"ok":true}']);

    preprocessSpy.mockRestore();
    createSpy.mockRestore();
  });

  it("detects --mcp after --format variants and ignores unknown leading flags", async () => {
    const harness = createHarness();
    const preprocessSpy = vi.spyOn(cliIncur, "preprocessIncurArgv").mockImplementation((argv) => argv);
    const createSpy = vi.spyOn(cliIncur, "createCobuildIncurCli").mockReturnValue({
      async serve() {
        return;
      },
    } as unknown as ReturnType<typeof cliIncur.createCobuildIncurCli>);

    await runCli(["--format", "json", "--mcp"], harness.deps);
    await runCli(["--format=json", "--mcp"], harness.deps);
    await runCli(["--unknown-flag", "wallet"], harness.deps);

    expect(preprocessSpy).toHaveBeenNthCalledWith(1, ["--format", "json", "--mcp"]);
    expect(preprocessSpy).toHaveBeenNthCalledWith(2, ["--format=json", "--mcp"]);
    expect(preprocessSpy).toHaveBeenNthCalledWith(3, ["--unknown-flag", "wallet"]);

    expect(createSpy).toHaveBeenNthCalledWith(1, expect.objectContaining(harness.deps), { mcpMode: true });
    expect(createSpy).toHaveBeenNthCalledWith(2, expect.objectContaining(harness.deps), { mcpMode: true });
    expect(createSpy).toHaveBeenNthCalledWith(3, harness.deps, { mcpMode: false });
    const firstMcpDeps = createSpy.mock.calls[0]?.[0] as { isInteractive?: () => boolean };
    const secondMcpDeps = createSpy.mock.calls[1]?.[0] as { isInteractive?: () => boolean };
    expect(firstMcpDeps.isInteractive?.()).toBe(false);
    expect(secondMcpDeps.isInteractive?.()).toBe(false);

    preprocessSpy.mockRestore();
    createSpy.mockRestore();
  });
});
