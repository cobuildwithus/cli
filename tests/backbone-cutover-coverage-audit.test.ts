import { describe, expect, it } from "vitest";
import { createCobuildIncurCli, preprocessIncurArgv } from "../src/cli-incur.js";
import { runCli } from "../src/cli.js";
import { createHarness } from "./helpers.js";

describe("backbone cutover coverage audit", () => {
  it("preserves leading --format flags while preprocessing docs query positionals", () => {
    expect(preprocessIncurArgv(["--format", "pretty", "docs", "how", "to", "send"])).toEqual([
      "--format",
      "pretty",
      "docs",
      "__incur_positional__how to send",
    ]);

    expect(preprocessIncurArgv(["--format=json", "docs", "setup", "approval"])).toEqual([
      "--format=json",
      "docs",
      "__incur_positional__setup approval",
    ]);
  });

  it("keeps non-json global flags when remapping leading setup --json", () => {
    expect(preprocessIncurArgv(["--format=json", "--json", "setup", "--url", "https://api.example"])).toEqual([
      "--format=json",
      "setup",
      "--setup-json",
      "--url",
      "https://api.example",
    ]);
  });

  it("blocks setup execution when the runtime is already in mcp mode", async () => {
    const harness = createHarness();
    const cli = createCobuildIncurCli(harness.deps, { mcpMode: true });
    const mcpOutput: string[] = [];

    await expect(
      cli.serve(["setup", "--url", "https://api.example", "--token", "bbt_secret"], {
        env: harness.deps.env,
        stdout: (chunk) => {
          mcpOutput.push(chunk);
        },
        exit: (code) => {
          throw new Error(`exit:${code}`);
        },
      })
    ).rejects.toThrow("exit:1");

    expect(harness.fetchMock).not.toHaveBeenCalled();
    expect(mcpOutput.join("\n")).toContain("setup is not available in MCP mode");
  });
});
