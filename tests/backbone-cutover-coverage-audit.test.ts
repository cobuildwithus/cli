import { describe, expect, it } from "vitest";
import { createCobuildIncurCli, preprocessIncurArgv } from "../src/cli-incur.js";
import { createHarness } from "./helpers.js";

const POSITIONAL_ESCAPE_PREFIX = "__incur_positional_b64__";

function encodeEscapedPositional(value: string): string {
  return `${POSITIONAL_ESCAPE_PREFIX}${Buffer.from(value, "utf8").toString("base64url")}`;
}

describe("backbone cutover coverage audit", () => {
  it("preserves leading --format flags while preprocessing docs query positionals", () => {
    expect(preprocessIncurArgv(["--format", "pretty", "docs", "how", "to", "send"])).toEqual([
      "--format",
      "pretty",
      "docs",
      encodeEscapedPositional("how to send"),
    ]);

    expect(preprocessIncurArgv(["--format=json", "docs", "setup", "approval"])).toEqual([
      "--format=json",
      "docs",
      encodeEscapedPositional("setup approval"),
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

  it("omits setup from MCP runtime command manifests", async () => {
    const harness = createHarness();
    const cli = createCobuildIncurCli(harness.deps, { mcpMode: true });
    const llmsOutput: string[] = [];

    await cli.serve(["--llms", "--format", "json"], {
      env: harness.deps.env,
      stdout: (chunk) => {
        llmsOutput.push(chunk);
      },
    });

    const manifest = JSON.parse(llmsOutput.join(""));
    const commandNames = Array.isArray(manifest.commands)
      ? manifest.commands.map((entry: { name?: string }) => entry.name)
      : [];
    expect(commandNames).not.toContain("setup");
  });

  it("rejects setup in MCP runtime because it is not registered", async () => {
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
    expect(mcpOutput.join("\n")).toContain("not a command");
  });
});
