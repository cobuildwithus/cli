import { describe, expect, it, vi } from "vitest";
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

  it("strips deprecated chatApiUrl when writing config", () => {
    const { deps, configFile, files } = createHarness();
    writeConfig(
      deps,
      {
        url: "https://api.example",
        token: "bbt_123",
        agent: "alpha",
        chatApiUrl: "https://chat.example",
      } as unknown as ReturnType<typeof readConfig>
    );

    const raw = files.get(configFile) ?? "{}";
    expect(raw).not.toContain("chatApiUrl");
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

  it("tightens directory and file permissions after writes", () => {
    const harness = createHarness();
    const chmod = vi.fn();
    harness.deps.fs.chmodSync = chmod;

    writeConfig(harness.deps, {
      url: "https://api.example",
      token: "bbt_123",
    });

    expect(chmod).toHaveBeenNthCalledWith(1, "/tmp/buildbot-tests/.buildbot", 0o700);
    expect(chmod).toHaveBeenNthCalledWith(2, harness.configFile, 0o600);
  });

  it("throws when config JSON is invalid", () => {
    const { deps } = createHarness({ rawConfig: "{ not-json" });
    expect(() => readConfig(deps)).toThrow(/not valid JSON/);
  });

  it("requires url and token", () => {
    const missingUrl = createHarness({ config: { token: "bbt_1" } });
    expect(() => requireConfig(missingUrl.deps)).toThrow(/Missing interface API base URL/);

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

  it("ignores deprecated chatApiUrl values in existing configs", () => {
    const { deps } = createHarness({
      rawConfig: JSON.stringify(
        {
          url: "https://api.example",
          chatApiUrl: "https://chat.example",
          token: "bbt_abc",
          agent: "ops",
        },
        null,
        2
      ),
    });

    expect(readConfig(deps)).toEqual({
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
