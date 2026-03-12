import { buildGoalTerminalPayPlan } from "@cobuild/wire";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeGoalPayCommand } from "../src/commands/goal-pay.js";
import { deriveProtocolPlanStepIdempotencyKey } from "../src/protocol-plan/idempotency.js";
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
const TERMINAL = "0x000000000000000000000000000000000000dead";
const BENEFICIARY = "0x00000000000000000000000000000000000000aa";
const PAYMENT_TOKEN = "0x00000000000000000000000000000000000000cc";

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

describe("goal pay command", () => {
  beforeEach(() => {
    localExecMocks.executeLocalTxMock.mockReset();
  });

  it("supports dry-run goal terminal pay from JSON input", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
    });

    const result = await executeGoalPayCommand(
      {
        inputJson: JSON.stringify({
          terminal: TERMINAL,
          projectId: "11",
          amount: "1000000000000000000",
          beneficiary: BENEFICIARY,
          memo: "fund goal",
          network: "base",
          agent: "default",
          idempotencyKey: EXPLICIT_UUID,
        }),
        dryRun: true,
      },
      harness.deps
    );

    expect(result).toMatchObject({
      ok: true,
      dryRun: true,
      family: "goal",
      action: "goal.pay",
      idempotencyKey: EXPLICIT_UUID,
      steps: [
        {
          stepNumber: 1,
          kind: "contract-call",
          request: {
            kind: "tx",
            network: "base",
            agentKey: "default",
            to: TERMINAL.toLowerCase(),
            valueEth: "1",
          },
        },
      ],
    });
    expect(harness.fetchMock).not.toHaveBeenCalled();
    expect(localExecMocks.executeLocalTxMock).not.toHaveBeenCalled();
  });

  it("reads goal pay input from --input-file through executeGoalPayCommand", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
    });
    const inputPath = "/tmp/cli-tests/goal-pay.json";
    harness.files.set(
      inputPath,
      JSON.stringify({
        terminal: TERMINAL,
        projectId: "12",
        amount: "1000000000000000000",
        beneficiary: BENEFICIARY,
        idempotencyKey: EXPLICIT_UUID,
      })
    );

    const result = await executeGoalPayCommand(
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
      family: "goal",
      walletMode: "hosted",
      idempotencyKey: EXPLICIT_UUID,
      action: "goal.pay",
      stepCount: 1,
      executedStepCount: 0,
      steps: [
        {
          stepNumber: 1,
          kind: "contract-call",
          request: {
            kind: "tx",
            network: "base",
            agentKey: "default",
            to: TERMINAL.toLowerCase(),
            valueEth: "1",
          },
        },
      ],
    });
  });

  it("forwards optional ERC-20 goal pay fields into the dry-run execution plan", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
        agent: "config-agent",
      },
    });
    harness.files.set(
      "/tmp/cli-tests/.cobuild-cli/agents/goal-payer/wallet/payer.json",
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
    const expectedPlan = buildGoalTerminalPayPlan({
      terminal: TERMINAL,
      projectId: "15",
      token: PAYMENT_TOKEN,
      amount: "25",
      beneficiary: BENEFICIARY,
      minReturnedTokens: "9",
      memo: "fund goal",
      metadata: "0x1234",
      network: "base-mainnet",
    });

    const result = await executeGoalPayCommand(
      {
        inputJson: JSON.stringify({
          terminal: TERMINAL,
          projectId: "15",
          token: PAYMENT_TOKEN,
          amount: "25",
          beneficiary: BENEFICIARY,
          minReturnedTokens: "9",
          memo: "fund goal",
          metadata: "0x1234",
          network: "base-mainnet",
          agent: "goal-payer",
          idempotencyKey: EXPLICIT_UUID,
        }),
        dryRun: true,
      },
      harness.deps
    );

    expect(result).toMatchObject({
      ok: true,
      dryRun: true,
      family: "goal",
      walletMode: "hosted",
      action: "goal.pay",
      agentKey: "goal-payer",
      network: "base",
      idempotencyKey: EXPLICIT_UUID,
      stepCount: 2,
      executedStepCount: 0,
      preconditions: expectedPlan.preconditions,
      steps: [
        {
          stepNumber: 1,
          kind: "erc20-approval",
          tokenAddress: PAYMENT_TOKEN.toLowerCase(),
          spenderAddress: TERMINAL.toLowerCase(),
          amount: "25",
          transaction: expectedPlan.steps[0]?.transaction,
          request: {
            kind: "tx",
            network: "base",
            agentKey: "goal-payer",
            to: PAYMENT_TOKEN.toLowerCase(),
            data: expectedPlan.steps[0]?.transaction.data,
            valueEth: "0",
          },
        },
        {
          stepNumber: 2,
          kind: "contract-call",
          contract: "CobuildGoalTerminal",
          functionName: "pay",
          transaction: expectedPlan.steps[1]?.transaction,
          request: {
            kind: "tx",
            network: "base",
            agentKey: "goal-payer",
            to: TERMINAL.toLowerCase(),
            data: expectedPlan.steps[1]?.transaction.data,
            valueEth: "0",
          },
        },
      ],
    });
    expect(harness.fetchMock).not.toHaveBeenCalled();
    expect(localExecMocks.executeLocalTxMock).not.toHaveBeenCalled();
  });

  it("routes hosted goal terminal pay through /api/cli/exec", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
      fetchResponder: async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true, transactionHash: "0x1234" }),
      }),
    });

    const result = await executeGoalPayCommand(
      {
        inputJson: JSON.stringify({
          terminal: TERMINAL,
          projectId: "11",
          amount: "1000000000000000000",
          beneficiary: BENEFICIARY,
          idempotencyKey: EXPLICIT_UUID,
        }),
      },
      harness.deps
    );

    expect(harness.fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = harness.fetchMock.mock.calls[0]!;
    expect(JSON.parse(String(init?.body))).toMatchObject({
      kind: "tx",
      network: "base",
      agentKey: "default",
      to: TERMINAL.toLowerCase(),
      valueEth: "1",
    });
    expect(result).toMatchObject({
      ok: true,
      family: "goal",
      action: "goal.pay",
      executedStepCount: 1,
    });
  });

  it("routes local goal terminal pay through one local tx execution", async () => {
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

    const result = await executeGoalPayCommand(
      {
        inputJson: JSON.stringify({
          terminal: TERMINAL,
          projectId: "11",
          amount: "1000000000000000000",
          beneficiary: BENEFICIARY,
          idempotencyKey: EXPLICIT_UUID,
        }),
      },
      harness.deps
    );

    expect(localExecMocks.executeLocalTxMock).toHaveBeenCalledTimes(1);
    expect(localExecMocks.executeLocalTxMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agentKey: "default",
        network: "base",
        to: TERMINAL.toLowerCase(),
        valueEth: "1",
      })
    );
    expect(result).toMatchObject({
      ok: true,
      family: "goal",
      action: "goal.pay",
      executedStepCount: 1,
    });
  });

  it("reads goal pay input from --input-stdin and adds approval before ERC-20 goal pays", async () => {
    const harness = createHarness({
      config: {
        agent: "default",
      },
    });
    setLocalWalletConfig(harness);
    harness.deps.readStdin = async () =>
      JSON.stringify({
        terminal: TERMINAL,
        projectId: "14",
        token: PAYMENT_TOKEN,
        amount: "25",
        beneficiary: BENEFICIARY,
        idempotencyKey: EXPLICIT_UUID,
      });
    const expectedPlan = buildGoalTerminalPayPlan({
      terminal: TERMINAL,
      projectId: "14",
      token: PAYMENT_TOKEN,
      amount: "25",
      beneficiary: BENEFICIARY,
    });
    const approvalKey = deriveProtocolPlanStepIdempotencyKey({
      rootIdempotencyKey: EXPLICIT_UUID,
      plan: expectedPlan,
      step: expectedPlan.steps[0]!,
      stepNumber: 1,
    });
    const payKey = deriveProtocolPlanStepIdempotencyKey({
      rootIdempotencyKey: EXPLICIT_UUID,
      plan: expectedPlan,
      step: expectedPlan.steps[1]!,
      stepNumber: 2,
    });
    localExecMocks.executeLocalTxMock
      .mockResolvedValueOnce({
        ok: true,
        kind: "tx",
        transactionHash: "0xapprove",
      })
      .mockResolvedValueOnce({
        ok: true,
        kind: "tx",
        transactionHash: "0xpay",
        explorerUrl: "https://explorer.example/tx/0xpay",
      });

    const result = await executeGoalPayCommand(
      {
        inputStdin: true,
      },
      harness.deps
    );

    expect(localExecMocks.executeLocalTxMock).toHaveBeenCalledTimes(2);
    expect(localExecMocks.executeLocalTxMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        agentKey: "default",
        network: "base",
        to: PAYMENT_TOKEN.toLowerCase(),
        valueEth: "0",
        idempotencyKey: approvalKey,
      })
    );
    expect(localExecMocks.executeLocalTxMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        agentKey: "default",
        network: "base",
        to: TERMINAL.toLowerCase(),
        valueEth: "0",
        idempotencyKey: payKey,
      })
    );
    expect(harness.fetchMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: true,
      family: "goal",
      walletMode: "local",
      action: "goal.pay",
      idempotencyKey: EXPLICIT_UUID,
      stepCount: 2,
      executedStepCount: 2,
      preconditions: [],
      replayedStepCount: 0,
      steps: [
        {
          stepNumber: 1,
          idempotencyKey: approvalKey,
          transactionHash: "0xapprove",
        },
        {
          stepNumber: 2,
          idempotencyKey: payKey,
          transactionHash: "0xpay",
          explorerUrl: "https://explorer.example/tx/0xpay",
        },
      ],
    });
  });

  it("rejects missing goal pay input", async () => {
    const harness = createHarness();

    await expect(executeGoalPayCommand({}, harness.deps)).rejects.toThrow(
      "Usage: cli goal pay --input-json <json>|--input-file <path>|--input-stdin [--dry-run]"
    );
    await expect(executeGoalPayCommand({}, harness.deps)).rejects.toThrow(
      "goal pay input is required."
    );
  });

  it("validates optional goal pay fields when provided", async () => {
    const harness = createHarness();

    await expect(
      executeGoalPayCommand(
        {
          inputJson: JSON.stringify({
            terminal: TERMINAL,
            projectId: "11",
            amount: "1",
            beneficiary: BENEFICIARY,
            minReturnedTokens: -1,
          }),
        },
        harness.deps
      )
    ).rejects.toThrow('goal pay input "minReturnedTokens" must be a non-negative integer.');

    await expect(
      executeGoalPayCommand(
        {
          inputJson: JSON.stringify({
            terminal: TERMINAL,
            projectId: "11",
            amount: "1",
            beneficiary: BENEFICIARY,
            metadata: "   ",
          }),
        },
        harness.deps
      )
    ).rejects.toThrow('goal pay input "metadata" must be a non-empty string when provided.');
  });
});
