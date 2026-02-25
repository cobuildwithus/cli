import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";
import { createHarness } from "./helpers.js";

const VALID_TO = "0x000000000000000000000000000000000000dEaD";

function createJsonResponder(body: unknown, status = 200) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  });
}

function parseLastJsonOutput(outputs: string[]): unknown {
  return JSON.parse(outputs.at(-1) ?? "null");
}

describe("env contract hard cutover", () => {
  it("setup ignores deprecated BUILD_BOT_URL and BUILD_BOT_NETWORK environment inputs", async () => {
    const harness = createHarness({
      fetchResponder: createJsonResponder({ ok: true, address: "0xabc" }),
    });
    harness.deps.env = {
      BUILD_BOT_URL: "https://legacy.example",
      BUILD_BOT_NETWORK: "base",
    };
    harness.deps.isInteractive = () => false;

    await runCli(["setup", "--token", "bbt_secret"], harness.deps);

    const [input, init] = harness.fetchMock.mock.calls[0];
    expect(String(input)).toBe("https://co.build/api/buildbot/wallet");
    expect(JSON.parse(String(init?.body))).toEqual({
      agentKey: "default",
      defaultNetwork: "base-sepolia",
    });
  });

  it("setup enables JSON mode from COBUILD_CLI_OUTPUT and ignores BUILD_BOT_OUTPUT", async () => {
    const jsonHarness = createHarness({
      fetchResponder: createJsonResponder({ ok: true, address: "0xabc" }),
    });
    jsonHarness.deps.env = {
      COBUILD_CLI_OUTPUT: "json",
      BUILD_BOT_OUTPUT: "json",
    };
    jsonHarness.deps.isInteractive = () => true;

    await runCli(["setup", "--url", "https://api.example", "--token", "bbt_secret"], jsonHarness.deps);

    expect(jsonHarness.outputs).not.toContain("CLI Setup Wizard");
    expect(parseLastJsonOutput(jsonHarness.outputs)).toEqual({
      ok: true,
      config: {
        interfaceUrl: "https://api.example",
        agent: "default",
        path: jsonHarness.configFile,
      },
      defaultNetwork: "base-sepolia",
      wallet: { ok: true, address: "0xabc" },
      next: [
        "Run: cli wallet",
        "Run: cli send usdc 0.10 <to> (or cli send eth 0.00001 <to>)",
      ],
    });

    const legacyOnlyHarness = createHarness({
      fetchResponder: createJsonResponder({ ok: true, address: "0xabc" }),
    });
    legacyOnlyHarness.deps.env = {
      BUILD_BOT_OUTPUT: "json",
    };
    legacyOnlyHarness.deps.isInteractive = () => true;

    await runCli(["setup", "--url", "https://api.example", "--token", "bbt_secret"], legacyOnlyHarness.deps);

    expect(legacyOnlyHarness.outputs).toContain("CLI Setup Wizard");
    expect(legacyOnlyHarness.outputs).toContain(`Saved config: ${legacyOnlyHarness.configFile}`);
  });

  it("send ignores deprecated BUILD_BOT_NETWORK when COBUILD_CLI_NETWORK is unset", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
      fetchResponder: createJsonResponder({ ok: true }),
    });
    const previousCliNetwork = process.env.COBUILD_CLI_NETWORK;
    const previousLegacyNetwork = process.env.BUILD_BOT_NETWORK;
    delete process.env.COBUILD_CLI_NETWORK;
    process.env.BUILD_BOT_NETWORK = "base";

    try {
      await runCli(["send", "usdc", "1.0", VALID_TO], harness.deps);
    } finally {
      if (previousCliNetwork === undefined) {
        delete process.env.COBUILD_CLI_NETWORK;
      } else {
        process.env.COBUILD_CLI_NETWORK = previousCliNetwork;
      }
      if (previousLegacyNetwork === undefined) {
        delete process.env.BUILD_BOT_NETWORK;
      } else {
        process.env.BUILD_BOT_NETWORK = previousLegacyNetwork;
      }
    }

    const [, init] = harness.fetchMock.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toMatchObject({
      network: "base-sepolia",
    });
  });

  it("tx ignores deprecated BUILD_BOT_NETWORK when COBUILD_CLI_NETWORK is unset", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
      fetchResponder: createJsonResponder({ ok: true }),
    });
    const previousCliNetwork = process.env.COBUILD_CLI_NETWORK;
    const previousLegacyNetwork = process.env.BUILD_BOT_NETWORK;
    delete process.env.COBUILD_CLI_NETWORK;
    process.env.BUILD_BOT_NETWORK = "base";

    try {
      await runCli(["tx", "--to", VALID_TO, "--data", "0xdeadbeef"], harness.deps);
    } finally {
      if (previousCliNetwork === undefined) {
        delete process.env.COBUILD_CLI_NETWORK;
      } else {
        process.env.COBUILD_CLI_NETWORK = previousCliNetwork;
      }
      if (previousLegacyNetwork === undefined) {
        delete process.env.BUILD_BOT_NETWORK;
      } else {
        process.env.BUILD_BOT_NETWORK = previousLegacyNetwork;
      }
    }

    const [, init] = harness.fetchMock.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toMatchObject({
      network: "base-sepolia",
    });
  });
});
