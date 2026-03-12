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

    await cli.serve(["--llms-full", "--format", "json"], {
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

  it("includes output schemas for wallet and farcaster command surfaces", async () => {
    const harness = createHarness();
    const cli = createCobuildIncurCli(harness.deps);
    const llmsOutput: string[] = [];

    await cli.serve(["--llms-full", "--format", "json"], {
      env: harness.deps.env,
      stdout: (chunk) => {
        llmsOutput.push(chunk);
      },
    });

    const manifest = JSON.parse(llmsOutput.join("")) as {
      commands?: Array<{
        name?: string;
        schema?: {
          output?: unknown;
        };
      }>;
    };

    const commands = Array.isArray(manifest.commands) ? manifest.commands : [];
    const wallet = commands.find((entry) => entry.name === "wallet");
    const farcasterSignup = commands.find((entry) => entry.name === "farcaster signup");
    const farcasterPost = commands.find((entry) => entry.name === "farcaster post");

    const walletOutput = wallet?.schema?.output as { properties?: Record<string, unknown> } | undefined;
    const signupOutput = farcasterSignup?.schema?.output as { properties?: Record<string, unknown> } | undefined;
    const postOutput = farcasterPost?.schema?.output as { properties?: Record<string, unknown> } | undefined;

    expect(walletOutput?.properties).toHaveProperty("walletConfig");
    expect(signupOutput?.properties).toHaveProperty("signer");
    expect(postOutput?.properties).toHaveProperty("idempotencyKey");
  });

  it("exposes the built-in --schema global for machine-readable command introspection", async () => {
    const harness = createHarness();
    const cli = createCobuildIncurCli(harness.deps);
    const schemaOutput: string[] = [];

    await cli.serve(["wallet", "--schema", "--format", "json"], {
      env: harness.deps.env,
      stdout: (chunk) => {
        schemaOutput.push(chunk);
      },
    });

    const schema = JSON.parse(schemaOutput.join("")) as {
      options?: { properties?: Record<string, unknown> };
      output?: { properties?: Record<string, unknown> };
    };

    expect(schema.options?.properties).toHaveProperty("network");
    expect(schema.output?.properties).toHaveProperty("walletConfig");
  });

  it("emits participant command schemas with result and without stale response fields", async () => {
    const harness = createHarness();
    const cli = createCobuildIncurCli(harness.deps);
    const schemaOutput: string[] = [];

    await cli.serve(["flow", "sync-allocation", "--schema", "--format", "json"], {
      env: harness.deps.env,
      stdout: (chunk) => {
        schemaOutput.push(chunk);
      },
    });

    const schema = JSON.parse(schemaOutput.join("")) as {
      output?: {
        properties?: Record<string, unknown>;
      };
    };
    const steps = schema.output?.properties?.steps as {
      items?: {
        properties?: Record<string, unknown>;
      };
    };

    expect(steps.items?.properties).toHaveProperty("result");
    expect(steps.items?.properties).not.toHaveProperty("response");
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
