import { describe, expect, it } from "vitest";
import { configPath, maskToken, readConfig, requireConfig, writeConfig } from "../src/config.js";
import { createHarness } from "./helpers.js";

describe("config", () => {
  it("builds config path with the buildbot directory", () => {
    expect(
      configPath({
        homedir: () => "/tmp/buildbot-home",
      })
    ).toBe("/tmp/buildbot-home/.buildbot/config.json");
  });

  it("returns the standard config path", () => {
    const { deps, configFile } = createHarness();
    expect(configPath(deps)).toBe(configFile);
  });

  it("returns empty config when file is missing", () => {
    const { deps } = createHarness();
    expect(readConfig(deps)).toEqual({});
  });

  it("writes and reads config", () => {
    const { deps } = createHarness();
    writeConfig(deps, {
      url: "https://api.example",
      token: "bbt_123",
      agent: "alpha",
    });

    expect(readConfig(deps)).toEqual({
      url: "https://api.example",
      token: "bbt_123",
      agent: "alpha",
    });
  });

  it("writes config atomically without leaving temp files", () => {
    const harness = createHarness();
    writeConfig(harness.deps, {
      url: "https://api.example",
      token: "bbt_123",
    });

    const fileKeys = [...harness.files.keys()];
    expect(fileKeys).toEqual([harness.configFile]);
  });

  it("throws when config JSON is invalid", () => {
    const { deps } = createHarness({ rawConfig: "{ not-json" });
    expect(() => readConfig(deps)).toThrow(/not valid JSON/);
  });

  it("requires url and token", () => {
    const missingUrl = createHarness({ config: { token: "bbt_1" } });
    expect(() => requireConfig(missingUrl.deps)).toThrow(/Missing API base URL/);

    const missingToken = createHarness({ config: { url: "https://api.example" } });
    expect(() => requireConfig(missingToken.deps)).toThrow(/Missing PAT token/);
  });

  it("returns required config when present", () => {
    const { deps } = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_abc",
        agent: "ops",
      },
    });

    expect(requireConfig(deps)).toEqual({
      url: "https://api.example",
      token: "bbt_abc",
      agent: "ops",
    });
  });

  it("masks token values", () => {
    expect(maskToken(undefined)).toBeNull();
    expect(maskToken("abcdefghijk")).toBe("abcdefgh...");
  });
});
