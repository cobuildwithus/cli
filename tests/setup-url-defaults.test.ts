import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";
import { createHarness } from "./helpers.js";

function expectedPersistedSetupConfig(url: string) {
  const encodedOrigin = new URL(url).origin.replaceAll("~", "~0").replaceAll("/", "~1");
  const isLoopback = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(url);
  return {
    url,
    chatApiUrl: isLoopback ? "http://localhost:4000" : "https://chat-api.co.build",
    agent: "default",
    auth: {
      tokenRef: {
        source: "file",
        provider: "default",
        id: `/oauth_refresh:${encodedOrigin}`,
      },
    },
    secrets: {
      providers: {
        default: {
          source: "file",
          path: "/tmp/cli-tests/.cobuild-cli/secrets.json",
          mode: "json",
        },
      },
      defaults: {
        env: "default",
        file: "default",
        exec: "default",
      },
    },
  };
}

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
    expect(String(input)).toBe("https://co.build/api/cli/wallet");
    expect(JSON.parse(harness.files.get(harness.configFile) ?? "{}")).toEqual(
      expectedPersistedSetupConfig("https://co.build")
    );
  });

  it("supports --dev default url for localhost", async () => {
    const harness = createHarness({
      fetchResponder: createJsonResponder({ ok: true, address: "0xabc" }),
    });

    await runCli(["setup", "--dev", "--token", "bbt_secret"], harness.deps);

    const [input] = harness.fetchMock.mock.calls[0];
    expect(String(input)).toBe("http://localhost:3000/api/cli/wallet");
    expect(JSON.parse(harness.files.get(harness.configFile) ?? "{}")).toEqual(
      expectedPersistedSetupConfig("http://localhost:3000")
    );
  });

  it("normalizes bare localhost host input", async () => {
    const harness = createHarness({
      fetchResponder: createJsonResponder({ ok: true, address: "0xabc" }),
    });

    await runCli(["setup", "--url", "localhost:3000", "--token", "bbt_secret"], harness.deps);

    const [input] = harness.fetchMock.mock.calls[0];
    expect(String(input)).toBe("http://localhost:3000/api/cli/wallet");
    expect(JSON.parse(harness.files.get(harness.configFile) ?? "{}")).toEqual(
      expectedPersistedSetupConfig("http://localhost:3000")
    );
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
    expect(String(input)).toBe("http://localhost:3000/co.build/api/cli/wallet");
    expect(JSON.parse(harness.files.get(harness.configFile) ?? "{}")).toEqual(
      expectedPersistedSetupConfig("http://localhost:3000/co.build")
    );
  });

  it("normalizes bare public host input to https", async () => {
    const harness = createHarness({
      fetchResponder: createJsonResponder({ ok: true, address: "0xabc" }),
    });

    await runCli(["setup", "--url", "co.build", "--token", "bbt_secret"], harness.deps);

    const [input] = harness.fetchMock.mock.calls[0];
    expect(String(input)).toBe("https://co.build/api/cli/wallet");
    expect(JSON.parse(harness.files.get(harness.configFile) ?? "{}")).toEqual(
      expectedPersistedSetupConfig("https://co.build")
    );
  });

  it("prefers explicit interface URL even when --dev is set", async () => {
    const harness = createHarness({
      fetchResponder: createJsonResponder({ ok: true, address: "0xabc" }),
    });

    await runCli(["setup", "--dev", "--url", "https://co.build", "--token", "bbt_secret"], harness.deps);

    expect(JSON.parse(harness.files.get(harness.configFile) ?? "{}")).toEqual(
      expectedPersistedSetupConfig("https://co.build")
    );
  });
});
