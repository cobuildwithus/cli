import { buildCommunityTerminalAddToBalancePlan, cobuildTerminalAddress } from "@cobuild/wire";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runCli } from "../src/cli.js";
import { executeCommunityAddToBalanceCommand } from "../src/commands/community-add-to-balance.js";
import { createHarness } from "./helpers.js";

const localExecMocks = vi.hoisted(() => ({
  executeLocalTxMock: vi.fn(),
}));

vi.mock("../src/wallet/local-exec.js", async () => {
  const actual = await vi.importActual<typeof import("../src/wallet/local-exec.js")>(
    "../src/wallet/local-exec.js"
  );
  return {
    ...actual,
    executeLocalTx: localExecMocks.executeLocalTxMock,
  };
});

const EXPLICIT_UUID = "75d6e51f-4f27-4f17-b32f-4708fdb0f3be";
const COMMUNITY_TERMINAL = "0x000000000000000000000000000000000000dead";
const PAYMENT_TOKEN = "0x00000000000000000000000000000000000000bb";

function setLocalWalletConfig(harness: ReturnType<typeof createHarness>): void {
  harness.files.set(
    "/tmp/cli-tests/.cobuild-cli/agents/default/wallet/payer.json",
    JSON.stringify(
      {
        version: 1,
        mode: "local",
        payerAddress: "0x87F6433eae757DF1f471bF9Ce03fe32d751eaE35",
        payerRef: {
          source: "file",
          provider: "default",
          id: "/wallet:payer:default",
        },
        network: "base",
        token: "usdc",
        createdAt: "2026-03-03T00:00:00.000Z",
      },
      null,
      2
    )
  );
  harness.files.set(
    "/tmp/cli-tests/.cobuild-cli/secrets.json",
    JSON.stringify(
      {
        "wallet:payer:default": `0x${"01".repeat(31)}02`,
      },
      null,
      2
    )
  );
}

function setHostedWalletConfig(
  harness: ReturnType<typeof createHarness>,
  agentKey = "default"
): void {
  harness.files.set(
    `/tmp/cli-tests/.cobuild-cli/agents/${agentKey}/wallet/payer.json`,
    JSON.stringify(
      {
        version: 1,
        mode: "hosted",
        payerAddress: null,
        network: "base",
        token: "usdc",
        createdAt: "2026-03-03T00:00:00.000Z",
      },
      null,
      2
    )
  );
}

function parseLastJsonOutput(outputs: string[]): Record<string, unknown> {
  return JSON.parse(outputs.at(-1) ?? "{}") as Record<string, unknown>;
}

describe("community add-to-balance command", () => {
  beforeEach(() => {
    localExecMocks.executeLocalTxMock.mockReset();
  });

  it("supports dry-run community add-to-balance from JSON input", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
    });
    const expectedPlan = buildCommunityTerminalAddToBalancePlan({
      terminal: COMMUNITY_TERMINAL,
      projectId: "19",
      amount: "1000000000000000",
      memo: "top up",
    });

    await runCli(
      [
        "community",
        "add-to-balance",
        "--input-json",
        JSON.stringify({
          terminal: COMMUNITY_TERMINAL,
          projectId: "19",
          amount: "1000000000000000",
          memo: "top up",
          idempotencyKey: EXPLICIT_UUID,
        }),
        "--dry-run",
      ],
      harness.deps
    );

    expect(parseLastJsonOutput(harness.outputs)).toMatchObject({
      ok: true,
      dryRun: true,
      family: "community",
      action: "community.add-to-balance",
      steps: [
        {
          stepNumber: 1,
          kind: "contract-call",
          request: {
            kind: "tx",
            data: expectedPlan.transaction.data,
            to: COMMUNITY_TERMINAL.toLowerCase(),
            valueEth: "0.001",
          },
        },
      ],
    });
  });

  it("adds approval and balance steps for ERC-20 top-ups", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
    });

    await runCli(
      [
        "community",
        "add-to-balance",
        "--input-json",
        JSON.stringify({
          terminal: COMMUNITY_TERMINAL,
          projectId: "20",
          token: PAYMENT_TOKEN,
          amount: "88",
          idempotencyKey: EXPLICIT_UUID,
        }),
        "--dry-run",
      ],
      harness.deps
    );

    expect(parseLastJsonOutput(harness.outputs)).toMatchObject({
      ok: true,
      dryRun: true,
      family: "community",
      action: "community.add-to-balance",
      stepCount: 2,
      steps: [
        {
          stepNumber: 1,
          kind: "erc20-approval",
          request: {
            kind: "tx",
            to: PAYMENT_TOKEN.toLowerCase(),
          },
        },
        {
          stepNumber: 2,
          kind: "contract-call",
          request: {
            kind: "tx",
            to: COMMUNITY_TERMINAL.toLowerCase(),
            valueEth: "0",
          },
        },
      ],
    });
  });

  it("reads community add-to-balance input from --input-file through executeCommunityAddToBalanceCommand", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
    });
    setHostedWalletConfig(harness, "ops");
    const inputPath = "/tmp/cli-tests/community-add-to-balance.json";
    const expectedPlan = buildCommunityTerminalAddToBalancePlan({
      projectId: "21",
      amount: "1000000000000000",
      metadata: "0x1234",
    });
    harness.files.set(
      inputPath,
      JSON.stringify({
        projectId: "21",
        amount: "1000000000000000",
        agent: "ops",
        metadata: "0x1234",
        idempotencyKey: EXPLICIT_UUID,
      })
    );

    const result = await executeCommunityAddToBalanceCommand(
      {
        inputFile: inputPath,
        dryRun: true,
      },
      harness.deps
    );

    expect(harness.fetchMock).not.toHaveBeenCalled();
    expect(localExecMocks.executeLocalTxMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: true,
      dryRun: true,
      family: "community",
      walletMode: "hosted",
      idempotencyKey: EXPLICIT_UUID,
      action: "community.add-to-balance",
      agentKey: "ops",
      network: "base",
      stepCount: 1,
      executedStepCount: 0,
      preconditions: ["Ensure the transaction sends exactly 1000000000000000 wei as msg.value."],
      steps: [
        {
          stepNumber: 1,
          kind: "contract-call",
          request: {
            kind: "tx",
            network: "base",
            agentKey: "ops",
            data: expectedPlan.transaction.data,
            to: cobuildTerminalAddress.toLowerCase(),
            valueEth: "0.001",
          },
        },
      ],
    });
  });

  it("routes local community add-to-balance through the local wallet", async () => {
    const harness = createHarness({
      config: {
        agent: "default",
      },
    });
    setLocalWalletConfig(harness);
    localExecMocks.executeLocalTxMock.mockResolvedValue({
      ok: true,
      kind: "tx",
      transactionHash: "0xabcd",
    });

    await runCli(
      [
        "community",
        "add-to-balance",
        "--input-json",
        JSON.stringify({
          terminal: COMMUNITY_TERMINAL,
          projectId: "19",
          amount: "1000000000000000",
          idempotencyKey: EXPLICIT_UUID,
        }),
      ],
      harness.deps
    );

    expect(localExecMocks.executeLocalTxMock).toHaveBeenCalledTimes(1);
    expect(localExecMocks.executeLocalTxMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agentKey: "default",
        network: "base",
        to: COMMUNITY_TERMINAL.toLowerCase(),
        valueEth: "0.001",
      })
    );
    expect(parseLastJsonOutput(harness.outputs)).toMatchObject({
      ok: true,
      family: "community",
      action: "community.add-to-balance",
      executedStepCount: 1,
    });
  });

  it("reads community add-to-balance input from --input-stdin and executes through the hosted API", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
      fetchResponder: async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true, kind: "tx", transactionHash: "0x999" }),
      }),
    });
    harness.deps.readStdin = async () =>
      JSON.stringify({
        terminal: COMMUNITY_TERMINAL,
        projectId: "19",
        amount: "1000000000000000",
        network: "base-mainnet",
        idempotencyKey: EXPLICIT_UUID,
      });

    const result = await executeCommunityAddToBalanceCommand(
      {
        inputStdin: true,
      },
      harness.deps
    );

    expect(harness.fetchMock).toHaveBeenCalledTimes(1);
    const [input, init] = harness.fetchMock.mock.calls[0] ?? [];
    expect(String(input)).toBe("https://api.example/api/cli/exec");
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers).toMatchObject({
      authorization: "Bearer bbt_secret",
    });
    expect(headers["X-Idempotency-Key"]).toBe(headers["Idempotency-Key"]);
    expect(headers["X-Idempotency-Key"]).toEqual(expect.any(String));
    expect(headers["X-Idempotency-Key"]).not.toBe(EXPLICIT_UUID);
    expect(JSON.parse(String(init?.body))).toMatchObject({
      kind: "tx",
      network: "base",
      agentKey: "default",
      to: COMMUNITY_TERMINAL.toLowerCase(),
      valueEth: "0.001",
    });
    expect(localExecMocks.executeLocalTxMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: true,
      idempotencyKey: EXPLICIT_UUID,
      walletMode: "hosted",
      family: "community",
      action: "community.add-to-balance",
      network: "base",
      executedStepCount: 1,
      steps: [
        {
          stepNumber: 1,
          status: "succeeded",
          transactionHash: "0x999",
        },
      ],
    });
  });

  it("rejects missing or malformed community add-to-balance input", async () => {
    const harness = createHarness();

    await expect(executeCommunityAddToBalanceCommand({}, harness.deps)).rejects.toThrow(
      "Usage: cli community add-to-balance --input-json <json>|--input-file <path>|--input-stdin [--dry-run]\ncommunity add-to-balance input is required."
    );

    await expect(
      executeCommunityAddToBalanceCommand(
        {
          inputJson: JSON.stringify({
            projectId: "19",
            amount: -1,
          }),
        },
        harness.deps
      )
    ).rejects.toThrow('community add-to-balance input "amount" must be a non-negative integer.');
  });
});
