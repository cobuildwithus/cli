import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";
import { DEFAULT_CHAT_API_URL } from "../src/config.js";
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
  it("setup ignores deprecated CLI_URL and CLI_NETWORK environment inputs", async () => {
    const harness = createHarness({
      fetchResponder: createJsonResponder({ ok: true, address: "0xabc" }),
    });
    harness.deps.env = {
      CLI_URL: "https://legacy.example",
      CLI_NETWORK: "base",
    };
    harness.deps.isInteractive = () => false;

    await runCli(["setup", "--wallet-mode", "hosted", "--token", "bbt_secret"], harness.deps);

    const [input, init] = harness.fetchMock.mock.calls[0];
    expect(String(input)).toBe("https://co.build/api/cli/wallet");
    expect(JSON.parse(String(init?.body))).toEqual({
      agentKey: "default",
      defaultNetwork: "base",
    });
  });

  it("setup enables JSON mode from COBUILD_CLI_OUTPUT and ignores CLI_OUTPUT", async () => {
    const jsonHarness = createHarness({
      fetchResponder: createJsonResponder({ ok: true, address: "0xabc" }),
    });
    jsonHarness.deps.env = {
      COBUILD_CLI_OUTPUT: "json",
      CLI_OUTPUT: "json",
    };
    jsonHarness.deps.isInteractive = () => true;

    await runCli(
      ["setup", "--url", "https://api.example", "--token", "bbt_secret", "--wallet-mode", "hosted"],
      jsonHarness.deps
    );

    expect(jsonHarness.errors).not.toContain("CLI Setup Wizard");
    expect(parseLastJsonOutput(jsonHarness.outputs)).toEqual({
      ok: true,
      config: {
        interfaceUrl: "https://api.example",
        chatApiUrl: DEFAULT_CHAT_API_URL,
        agent: "default",
        path: jsonHarness.configFile,
      },
      defaultNetwork: "base",
      wallet: { ok: true, address: "0xabc" },
      walletConfig: {
        mode: "hosted",
        walletAddress: null,
        network: "base",
        token: "usdc",
        costPerPaidCallMicroUsdc: "1000",
      },
      next: [
        "Run: cobuild wallet status",
        "Run: cobuild send usdc 0.10 <to> (or cobuild send eth 0.00001 <to>)",
      ],
    });

    const legacyOnlyHarness = createHarness({
      fetchResponder: createJsonResponder({ ok: true, address: "0xabc" }),
    });
    legacyOnlyHarness.deps.env = {
      CLI_OUTPUT: "json",
    };
    legacyOnlyHarness.deps.isInteractive = () => true;

    await runCli(
      ["setup", "--url", "https://api.example", "--token", "bbt_secret", "--wallet-mode", "hosted"],
      legacyOnlyHarness.deps
    );

    expect(legacyOnlyHarness.errors).toContain("CLI Setup Wizard");
    expect(parseLastJsonOutput(legacyOnlyHarness.outputs)).toEqual({
      ok: true,
      config: {
        interfaceUrl: "https://api.example",
        chatApiUrl: DEFAULT_CHAT_API_URL,
        agent: "default",
        path: legacyOnlyHarness.configFile,
      },
      defaultNetwork: "base",
      wallet: { ok: true, address: "0xabc" },
      walletConfig: {
        mode: "hosted",
        walletAddress: null,
        network: "base",
        token: "usdc",
        costPerPaidCallMicroUsdc: "1000",
      },
      next: [
        "Run: cobuild wallet status",
        "Run: cobuild send usdc 0.10 <to> (or cobuild send eth 0.00001 <to>)",
      ],
    });
  });

  it("send ignores deprecated CLI_NETWORK when COBUILD_CLI_NETWORK is unset", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
      fetchResponder: createJsonResponder({ ok: true }),
    });
    const previousCliNetwork = process.env.COBUILD_CLI_NETWORK;
    const previousLegacyNetwork = process.env.CLI_NETWORK;
    delete process.env.COBUILD_CLI_NETWORK;
    process.env.CLI_NETWORK = "base";

    try {
      await runCli(["send", "usdc", "1.0", VALID_TO], harness.deps);
    } finally {
      if (previousCliNetwork === undefined) {
        delete process.env.COBUILD_CLI_NETWORK;
      } else {
        process.env.COBUILD_CLI_NETWORK = previousCliNetwork;
      }
      if (previousLegacyNetwork === undefined) {
        delete process.env.CLI_NETWORK;
      } else {
        process.env.CLI_NETWORK = previousLegacyNetwork;
      }
    }

    const [, init] = harness.fetchMock.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toMatchObject({
      network: "base",
    });
  });

  it("tx ignores deprecated CLI_NETWORK when COBUILD_CLI_NETWORK is unset", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
      fetchResponder: createJsonResponder({ ok: true }),
    });
    const previousCliNetwork = process.env.COBUILD_CLI_NETWORK;
    const previousLegacyNetwork = process.env.CLI_NETWORK;
    delete process.env.COBUILD_CLI_NETWORK;
    process.env.CLI_NETWORK = "base";

    try {
      await runCli(["tx", "--to", VALID_TO, "--data", "0xdeadbeef"], harness.deps);
    } finally {
      if (previousCliNetwork === undefined) {
        delete process.env.COBUILD_CLI_NETWORK;
      } else {
        process.env.COBUILD_CLI_NETWORK = previousCliNetwork;
      }
      if (previousLegacyNetwork === undefined) {
        delete process.env.CLI_NETWORK;
      } else {
        process.env.CLI_NETWORK = previousLegacyNetwork;
      }
    }

    const [, init] = harness.fetchMock.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toMatchObject({
      network: "base",
    });
  });
});
