import { afterEach, describe, expect, it, vi } from "vitest";
import os from "node:os";
import {
  buildOpenExternalCommand,
  defaultDeps,
  isAllowedExternalUrl,
  normalizeXdgOpenTarget,
} from "../src/deps.js";

describe("defaultDeps", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses the process homedir", () => {
    expect(defaultDeps.homedir()).toBe(os.homedir());
  });

  it("delegates fetch calls to global fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const response = await defaultDeps.fetch("https://api.example", { method: "POST" });
    expect(fetchSpy).toHaveBeenCalledWith("https://api.example", { method: "POST" });
    expect(response.ok).toBe(true);
  });

  it("writes to stdout and stderr", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    defaultDeps.stdout("hello");
    defaultDeps.stderr("oops");

    expect(logSpy).toHaveBeenCalledWith("hello");
    expect(errorSpy).toHaveBeenCalledWith("oops");
  });

  it("delegates exit to process.exit", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: string | number | null) => {
        throw new Error(`exit:${String(code)}`);
      });

    expect(() => defaultDeps.exit(9)).toThrow("exit:9");
    expect(exitSpy).toHaveBeenCalledWith(9);
  });
});

describe("buildOpenExternalCommand", () => {
  it("adds -- for macOS open to prevent option injection", () => {
    const command = buildOpenExternalCommand("darwin", "-a Calculator");
    expect(command).toEqual({
      cmd: "open",
      args: ["--", "-a Calculator"],
      options: { stdio: "ignore", detached: true },
    });
  });

  it("normalizes leading-dash xdg-open targets to prevent option injection", () => {
    const command = buildOpenExternalCommand("linux", "-x");
    expect(command).toEqual({
      cmd: "xdg-open",
      args: ["./-x"],
      options: { stdio: "ignore", detached: true },
    });
  });

  it("uses explorer on Windows so URL query separators are never parsed by cmd.exe", () => {
    const url = "https://example.com/path?x=1&y=2";
    const command = buildOpenExternalCommand("win32", url);

    expect(command).toEqual({
      cmd: "explorer.exe",
      args: [url],
      options: {
        stdio: "ignore",
        detached: true,
        windowsHide: true,
      },
    });
  });

  it("allows only http(s) URLs for external opener targets", () => {
    expect(isAllowedExternalUrl("https://example.com")).toBe(true);
    expect(isAllowedExternalUrl("http://localhost:3000")).toBe(true);
    expect(isAllowedExternalUrl("file:///tmp/a.txt")).toBe(false);
    expect(isAllowedExternalUrl("-a calculator")).toBe(false);
  });

  it("leaves non-leading-dash xdg-open targets unchanged", () => {
    expect(normalizeXdgOpenTarget("https://example.com")).toBe("https://example.com");
  });
});
