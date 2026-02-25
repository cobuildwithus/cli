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

describe("setup URL defaults and normalization", () => {
  it("defaults interface url to co.build in non-interactive mode", async () => {
    const harness = createHarness({
      fetchResponder: createJsonResponder({ ok: true, address: "0xabc" }),
    });

    await runCli(["setup", "--token", "bbt_secret"], harness.deps);

    const [input] = harness.fetchMock.mock.calls[0];
    expect(String(input)).toBe("https://co.build/api/buildbot/wallet");
    expect(JSON.parse(harness.files.get(harness.configFile) ?? "{}")).toEqual({
      url: "https://co.build",
      token: "bbt_secret",
      agent: "default",
    });
  });

  it("supports --dev default url for localhost", async () => {
    const harness = createHarness({
      fetchResponder: createJsonResponder({ ok: true, address: "0xabc" }),
    });

    await runCli(["setup", "--dev", "--token", "bbt_secret"], harness.deps);

    const [input] = harness.fetchMock.mock.calls[0];
    expect(String(input)).toBe("http://localhost:3000/api/buildbot/wallet");
    expect(JSON.parse(harness.files.get(harness.configFile) ?? "{}")).toEqual({
      url: "http://localhost:3000",
      token: "bbt_secret",
      agent: "default",
    });
  });

  it("normalizes bare localhost host input", async () => {
    const harness = createHarness({
      fetchResponder: createJsonResponder({ ok: true, address: "0xabc" }),
    });

    await runCli(["setup", "--url", "localhost:3000", "--token", "bbt_secret"], harness.deps);

    const [input] = harness.fetchMock.mock.calls[0];
    expect(String(input)).toBe("http://localhost:3000/api/buildbot/wallet");
    expect(JSON.parse(harness.files.get(harness.configFile) ?? "{}")).toEqual({
      url: "http://localhost:3000",
      token: "bbt_secret",
      agent: "default",
    });
  });

  it("normalizes bare localhost host input with path and preserves base path", async () => {
    const harness = createHarness({
      fetchResponder: createJsonResponder({ ok: true, address: "0xabc" }),
    });

    await runCli(
      ["setup", "--url", "localhost:3000/co.build", "--token", "bbt_secret"],
      harness.deps
    );

    const [input] = harness.fetchMock.mock.calls[0];
    expect(String(input)).toBe("http://localhost:3000/co.build/api/buildbot/wallet");
    expect(JSON.parse(harness.files.get(harness.configFile) ?? "{}")).toEqual({
      url: "http://localhost:3000/co.build",
      token: "bbt_secret",
      agent: "default",
    });
  });

  it("normalizes bare public host input to https", async () => {
    const harness = createHarness({
      fetchResponder: createJsonResponder({ ok: true, address: "0xabc" }),
    });

    await runCli(["setup", "--url", "co.build", "--token", "bbt_secret"], harness.deps);

    const [input] = harness.fetchMock.mock.calls[0];
    expect(String(input)).toBe("https://co.build/api/buildbot/wallet");
    expect(JSON.parse(harness.files.get(harness.configFile) ?? "{}")).toEqual({
      url: "https://co.build",
      token: "bbt_secret",
      agent: "default",
    });
  });

  it("prefers explicit interface URL even when --dev is set", async () => {
    const harness = createHarness({
      fetchResponder: createJsonResponder({ ok: true, address: "0xabc" }),
    });

    await runCli(["setup", "--dev", "--url", "https://co.build", "--token", "bbt_secret"], harness.deps);

    expect(JSON.parse(harness.files.get(harness.configFile) ?? "{}")).toEqual({
      url: "https://co.build",
      token: "bbt_secret",
      agent: "default",
    });
  });
});
