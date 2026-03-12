import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProtocolExecutionPlanLike } from "../src/protocol-plan/types.js";
import {
  executeTerminalFundingPlan,
  readOptionalBigintLikeArrayFromInputJson,
  readOptionalBigintLikeFromInputJson,
  readOptionalRecordFromInputJson,
  readOptionalStringFromInputJson,
  readRequiredBigintLikeFromInputJson,
  readRequiredJsonCommandInput,
  readRequiredStringFromInputJson,
} from "../src/commands/terminal-funding-shared.js";
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
const TOKEN = "0x00000000000000000000000000000000000000aa";
const TERMINAL = "0x00000000000000000000000000000000000000bb";

function setLocalWalletConfig(
  harness: ReturnType<typeof createHarness>,
  agentKey = "default"
): void {
  harness.files.set(
    `/tmp/cli-tests/.cobuild-cli/agents/${agentKey}/wallet/payer.json`,
    JSON.stringify(
      {
        version: 1,
        mode: "local",
        payerAddress: "0x87F6433eae757DF1f471bF9Ce03fe32d751eaE35",
        payerRef: {
          source: "file",
          provider: "default",
          id: `/wallet:payer:${agentKey}`,
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
        [`wallet:payer:${agentKey}`]: `0x${"01".repeat(31)}02`,
      },
      null,
      2
    )
  );
}

function createPlan(
  overrides: Partial<ProtocolExecutionPlanLike> = {}
): ProtocolExecutionPlanLike {
  return {
    network: "base",
    action: "community.pay",
    riskClass: "economic",
    summary: "Pay through the community terminal.",
    preconditions: ["Confirm the terminal configuration before execution."],
    expectedEvents: ["Approval", "Pay"],
    steps: [
      {
        kind: "erc20-approval",
        label: "Approve payment token",
        tokenAddress: TOKEN,
        spenderAddress: TERMINAL,
        amount: "88",
        transaction: {
          to: TOKEN,
          data: "0xaaaa",
          valueEth: "0",
        },
      },
      {
        kind: "contract-call",
        contract: "CobuildCommunityTerminal",
        functionName: "pay",
        label: "Pay community terminal",
        transaction: {
          to: TERMINAL,
          data: "0xbbbb",
          valueEth: "1",
        },
      },
    ],
    ...overrides,
  };
}

describe("terminal funding shared input readers", () => {
  it("reads and normalizes valid payload fields", async () => {
    const harness = createHarness();
    const inputPath = "/tmp/cli-tests/terminal-funding.json";
    harness.files.set(inputPath, JSON.stringify({ amount: "42" }));

    expect(readRequiredStringFromInputJson({ key: "  value  " }, "key", "payload")).toBe("value");
    expect(readOptionalStringFromInputJson({ key: "  value  " }, "key", "payload")).toBe("value");
    expect(readOptionalStringFromInputJson({}, "key", "payload")).toBeUndefined();
    expect(readRequiredBigintLikeFromInputJson({ key: " 42 " }, "key", "payload")).toBe("42");
    expect(readRequiredBigintLikeFromInputJson({ key: 42 }, "key", "payload")).toBe(42);
    expect(readRequiredBigintLikeFromInputJson({ key: 42n }, "key", "payload")).toBe(42n);
    expect(readOptionalBigintLikeFromInputJson({ key: " 7 " }, "key", "payload")).toBe("7");
    expect(readOptionalBigintLikeFromInputJson({}, "key", "payload")).toBeUndefined();
    expect(readOptionalRecordFromInputJson({ route: { goalIds: ["1"] } }, "route", "payload")).toEqual(
      {
        goalIds: ["1"],
      }
    );
    expect(
      readOptionalBigintLikeArrayFromInputJson({ values: [" 1 ", 2, 3n] }, "values", "payload")
    ).toEqual(["1", 2, 3n]);
    await expect(
      readRequiredJsonCommandInput(
        {
          inputFile: inputPath,
        },
        harness.deps,
        {
          usage: "Usage: cli test",
          valueLabel: "test input",
        }
      )
    ).resolves.toEqual({ amount: "42" });
  });

  it("rejects malformed payload fields", async () => {
    const harness = createHarness();

    expect(() => readRequiredStringFromInputJson({ key: "   " }, "key", "payload")).toThrow(
      'payload "key" must be a non-empty string.'
    );
    expect(() => readOptionalStringFromInputJson({ key: "   " }, "key", "payload")).toThrow(
      'payload "key" must be a non-empty string when provided.'
    );
    expect(() => readRequiredBigintLikeFromInputJson({ key: -1 }, "key", "payload")).toThrow(
      'payload "key" must be a non-negative integer.'
    );
    expect(() => readOptionalBigintLikeFromInputJson({ key: {} }, "key", "payload")).toThrow(
      'payload "key" must be a non-negative integer.'
    );
    expect(() => readOptionalRecordFromInputJson({ route: [] }, "route", "payload")).toThrow(
      'payload "route" must be an object when provided.'
    );
    expect(() =>
      readOptionalBigintLikeArrayFromInputJson({ values: "1" }, "values", "payload")
    ).toThrow('payload "values" must be an array when provided.');
    expect(() =>
      readOptionalBigintLikeArrayFromInputJson({ values: ["", 1] }, "values", "payload")
    ).toThrow('payload "values[0]" must be a non-negative integer.');
    await expect(
      readRequiredJsonCommandInput(
        {},
        harness.deps,
        {
          usage: "Usage: cli test",
          valueLabel: "test input",
        }
      )
    ).rejects.toThrow("Usage: cli test\ntest input is required.");
  });
});

describe("executeTerminalFundingPlan", () => {
  beforeEach(() => {
    localExecMocks.executeLocalTxMock.mockReset();
  });

  it("builds raw-tx dry-run output for approval and contract steps", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
        agent: "ops",
      },
    });

    const result = await executeTerminalFundingPlan({
      deps: harness.deps,
      family: "community",
      input: {
        agent: "ops",
        dryRun: true,
        idempotencyKey: EXPLICIT_UUID,
      },
      outputAction: "community.pay.compat",
      plan: createPlan(),
    });

    expect(result).toMatchObject({
      ok: true,
      dryRun: true,
      family: "community",
      action: "community.pay.compat",
      idempotencyKey: EXPLICIT_UUID,
      agentKey: "ops",
      walletMode: "hosted",
      network: "base",
      stepCount: 2,
      executedStepCount: 0,
      replayedStepCount: 0,
      expectedEvents: ["Approval", "Pay"],
      steps: [
        {
          stepNumber: 1,
          label: "Approve payment token",
          kind: "erc20-approval",
          executionTarget: "hosted_api",
          status: "dry-run",
          tokenAddress: TOKEN,
          spenderAddress: TERMINAL,
          amount: "88",
          request: {
            kind: "tx",
            network: "base",
            agentKey: "ops",
            to: TOKEN,
            data: "0xaaaa",
            valueEth: "0",
          },
        },
        {
          stepNumber: 2,
          label: "Pay community terminal",
          kind: "contract-call",
          executionTarget: "hosted_api",
          status: "dry-run",
          contract: "CobuildCommunityTerminal",
          functionName: "pay",
          request: {
            kind: "tx",
            network: "base",
            agentKey: "ops",
            to: TERMINAL,
            data: "0xbbbb",
            valueEth: "1",
          },
        },
      ],
    });
    expect(result.warnings).toContain(
      "Plan declares 1 precondition(s) that the CLI does not verify automatically."
    );
    expect(result.warnings).toContain(
      "Plan includes 1 ERC-20 approval step(s); verify spender addresses and allowance amounts before execution."
    );
    expect(result.warnings).toContain("Dry run only; no transactions were broadcast.");
    expect(harness.fetchMock).not.toHaveBeenCalled();
    expect(localExecMocks.executeLocalTxMock).not.toHaveBeenCalled();
  });

  it("executes local-wallet steps and tracks replayed results", async () => {
    const harness = createHarness({
      config: {
        agent: "pilot",
      },
    });
    setLocalWalletConfig(harness, "pilot");
    localExecMocks.executeLocalTxMock.mockResolvedValue({
      ok: true,
      transactionHash: "0x123",
      explorerUrl: "https://explorer.example/tx/0x123",
      replayed: true,
    });

    const result = await executeTerminalFundingPlan({
      deps: harness.deps,
      family: "community",
      input: {
        agent: "pilot",
        idempotencyKey: EXPLICIT_UUID,
      },
      plan: createPlan({
        preconditions: [],
        expectedEvents: undefined,
        steps: [createPlan().steps[1]!],
      }),
    });

    expect(localExecMocks.executeLocalTxMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agentKey: "pilot",
        network: "base",
        to: TERMINAL,
        data: "0xbbbb",
        valueEth: "1",
        idempotencyKey: expect.any(String),
      })
    );
    expect(result).toMatchObject({
      ok: true,
      family: "community",
      action: "community.pay",
      idempotencyKey: EXPLICIT_UUID,
      agentKey: "pilot",
      walletMode: "local",
      expectedEvents: [],
      executedStepCount: 1,
      replayedStepCount: 1,
      warnings: [],
      steps: [
        {
          stepNumber: 1,
          label: "Pay community terminal",
          executionTarget: "local_wallet",
          status: "succeeded",
          transactionHash: "0x123",
          explorerUrl: "https://explorer.example/tx/0x123",
          replayed: true,
          result: {
            replayed: true,
          },
        },
      ],
    });
    expect(harness.fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces hosted pending results with resume guidance", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
      fetchResponder: async () => ({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            status: "pending",
          }),
      }),
    });

    const error = await executeTerminalFundingPlan({
      deps: harness.deps,
      family: "community",
      input: {
        idempotencyKey: EXPLICIT_UUID,
      },
      plan: createPlan({
        preconditions: [],
        steps: [createPlan().steps[1]!],
      }),
    }).catch((reason: unknown) => reason as Error);

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain(
      "Step 1/1: Pay community terminal is still pending on the hosted wallet"
    );
    expect(error.message).toContain(`root idempotency key: ${EXPLICIT_UUID}`);
    expect(error.message).toContain("userOpHash: unknown");
  });

  it("wraps terminal step failures with step and root idempotency context", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
      fetchResponder: async () => {
        throw new Error("upstream broke");
      },
    });

    const error = await executeTerminalFundingPlan({
      deps: harness.deps,
      family: "community",
      input: {
        idempotencyKey: EXPLICIT_UUID,
      },
      plan: createPlan({
        preconditions: [],
        steps: [createPlan().steps[1]!],
      }),
    }).catch((reason: unknown) => reason as Error);

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain("Step 1/1: Pay community terminal failed: upstream broke");
    expect(error.message).toContain(`root idempotency key: ${EXPLICIT_UUID}`);
    expect(error.message).toContain(
      `Re-run the same command with the same JSON payload and idempotencyKey ${EXPLICIT_UUID} to resume safely.`
    );
  });
});
