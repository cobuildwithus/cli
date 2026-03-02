import { describe, expect, it, vi } from "vitest";
import * as cliIncur from "../src/cli-incur.js";
import { runCli } from "../src/cli.js";
import { createHarness } from "./helpers.js";

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

  it("collapses docs and tools multi-word positionals during Incur preprocessing", () => {
    expect(
      cliIncur.preprocessIncurArgv(["docs", "--limit", "5", "how", "to", "send", "usdc"])
    ).toEqual(["docs", "--limit", "5", "__incur_positional__how to send usdc"]);

    expect(
      cliIncur.preprocessIncurArgv(["docs", "--", "--token-stdin", "usage"])
    ).toEqual(["docs", "__incur_positional__--token-stdin usage"]);

    expect(
      cliIncur.preprocessIncurArgv(["tools", "get-user", "alice", "builder"])
    ).toEqual(["tools", "get-user", "__incur_positional__alice builder"]);

    expect(
      cliIncur.preprocessIncurArgv(["tools", "get-cast", "hello", "world", "--type", "url"])
    ).toEqual(["tools", "get-cast", "--type", "url", "__incur_positional__hello world"]);
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

    preprocessSpy.mockRestore();
    createSpy.mockRestore();
  });
});
