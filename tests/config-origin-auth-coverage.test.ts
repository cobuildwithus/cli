import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";
import { createHarness } from "./helpers.js";

function parseLastJsonOutput(outputs: string[]): unknown {
  return JSON.parse(outputs.at(-1) ?? "null");
}

function expectedPatTokenRef(interfaceUrl: string) {
  const origin = new URL(interfaceUrl).origin;
  const encoded = origin.replaceAll("~", "~0").replaceAll("/", "~1");
  return {
    source: "file",
    provider: "default",
    id: `/pat:${encoded}`,
  };
}

describe("config origin auth coverage", () => {
  it("preserves persisted auth when --url changes path on the same origin", async () => {
    const harness = createHarness();

    await runCli(
      ["config", "set", "--url", "https://api.example/base", "--token", "bbt_secret"],
      harness.deps
    );
    await runCli(["config", "set", "--url", "https://api.example/v2"], harness.deps);
    await runCli(["config", "show"], harness.deps);

    expect(parseLastJsonOutput(harness.outputs)).toEqual({
      interfaceUrl: "https://api.example/v2",
      chatApiUrl: "https://api.example/v2",
      token: "bbt_secr...",
      tokenRef: expectedPatTokenRef("https://api.example/v2"),
      agent: null,
      path: harness.configFile,
    });
  });

  it("preserves persisted auth when only --chat-api-url is updated", async () => {
    const harness = createHarness();

    await runCli(
      ["config", "set", "--url", "https://api.example", "--token", "bbt_secret"],
      harness.deps
    );
    await runCli(["config", "set", "--chat-api-url", "https://chat.example"], harness.deps);
    await runCli(["config", "show"], harness.deps);

    expect(parseLastJsonOutput(harness.outputs)).toEqual({
      interfaceUrl: "https://api.example",
      chatApiUrl: "https://chat.example",
      token: "bbt_secr...",
      tokenRef: expectedPatTokenRef("https://api.example"),
      agent: null,
      path: harness.configFile,
    });
  });
});
