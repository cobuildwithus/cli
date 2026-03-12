import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ProtocolExecutionPlanLike,
  ProtocolPlanStepLike,
} from "../src/protocol-plan/types.js";
import { deriveProtocolPlanStepIdempotencyKey } from "../src/protocol-plan/idempotency.js";
import { createHarness } from "./helpers.js";

const EXPLICIT_UUID = "75d6e51f-4f27-4f17-b32f-4708fdb0f3be";
const TERMINAL = "0x1111111111111111111111111111111111111111";
const BENEFICIARY = "0x2222222222222222222222222222222222222222";
const TOKEN = "0x3333333333333333333333333333333333333333";

const mocks = vi.hoisted(() => ({
  buildCommunityTerminalPayPlanMock: vi.fn(),
  executeLocalTxMock: vi.fn(),
}));

vi.mock("@cobuild/wire", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@cobuild/wire")>();
  return {
    ...actual,
    buildCommunityTerminalPayPlan: (...args: unknown[]) =>
      mocks.buildCommunityTerminalPayPlanMock(...args),
  };
});

vi.mock("../src/wallet/local-exec.js", async () => {
  const actual = await vi.importActual<typeof import("../src/wallet/local-exec.js")>(
    "../src/wallet/local-exec.js"
  );
  return {
    ...actual,
    executeLocalTx: (...args: unknown[]) => mocks.executeLocalTxMock(...args),
  };
});

import { executeCommunityPayCommand } from "../src/commands/community-pay.js";

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

function createPlan(overrides: Record<string, unknown> = {}) {
  return {
    action: "community.pay",
    chainId: 8453,
    network: "base",
    riskClass: "economic",
    summary: "Pay community 42 through terminal 0x1111111111111111111111111111111111111111.",
    preconditions: [],
    expectedEvents: ["Pay"],
    terminal: TERMINAL,
    projectId: 42n,
    token: TOKEN,
    amount: 1_500_000_000_000_000_000n,
    beneficiary: BENEFICIARY,
    minReturnedTokens: 2n,
    memo: "ship it",
    route: {
      goalIds: [7n, 8n],
      weights: [750_000, 250_000],
    },
    jbMetadata: "0x1234",
    metadata: "0xabcd",
    approvalIncluded: false,
    steps: [
      {
        kind: "contract-call",
        contract: "CobuildCommunityTerminal",
        functionName: "pay",
        label: "Pay community terminal",
        transaction: {
          to: TERMINAL,
          data: "0xfeed",
          valueEth: "1.5",
        },
      },
    ],
    transaction: {
      to: TERMINAL,
      data: "0xfeed",
      valueEth: "1.5",
    },
    writeContract: {
      address: TERMINAL,
      abi: [],
      functionName: "pay",
      args: [],
      value: 1_500_000_000_000_000_000n,
    },
    ...overrides,
  };
}

describe("community pay command", () => {
  beforeEach(() => {
    mocks.buildCommunityTerminalPayPlanMock.mockReset();
    mocks.executeLocalTxMock.mockReset();
  });

  it("builds a hosted dry-run raw tx request from JSON input", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
        agent: "default",
      },
    });
    mocks.buildCommunityTerminalPayPlanMock.mockReturnValue(createPlan());

    const result = await executeCommunityPayCommand(
      {
        inputJson: JSON.stringify({
          terminal: TERMINAL.toUpperCase(),
          projectId: "42",
          token: TOKEN.toUpperCase(),
          amount: "1500000000000000000",
          beneficiary: BENEFICIARY,
          minReturnedTokens: "2",
          memo: "ship it",
          route: {
            goalIds: ["7", "8"],
            weights: [750000, 250000],
          },
          jbMetadata: "0x1234",
        }),
        dryRun: true,
      },
      harness.deps
    );

    expect(mocks.buildCommunityTerminalPayPlanMock).toHaveBeenCalledWith({
      terminal: TERMINAL.toUpperCase(),
      projectId: "42",
      token: TOKEN.toUpperCase(),
      amount: "1500000000000000000",
      beneficiary: BENEFICIARY,
      minReturnedTokens: "2",
      memo: "ship it",
      route: {
        goalIds: ["7", "8"],
        weights: [750000, 250000],
      },
      jbMetadata: "0x1234",
    });
    expect(result).toMatchObject({
      ok: true,
      dryRun: true,
      idempotencyKey: "8e03978e-40d5-43e8-bc93-6894a57f9324",
      walletMode: "hosted",
      terminal: TERMINAL,
      projectId: "42",
      token: TOKEN,
      amount: "1500000000000000000",
      beneficiary: BENEFICIARY,
      minReturnedTokens: "2",
      memo: "ship it",
      route: {
        goalIds: ["7", "8"],
        weights: [750000, 250000],
      },
      jbMetadata: "0x1234",
      metadata: "0xabcd",
      request: {
        method: "POST",
        path: "/api/cli/exec",
        body: {
          kind: "tx",
          network: "base",
          agentKey: "default",
          to: TERMINAL,
          data: "0xfeed",
          valueEth: "1.5",
        },
      },
    });
    expect(harness.fetchMock).not.toHaveBeenCalled();
  });

  it("reads stdin JSON and executes hosted raw tx requests with payload execution overrides", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
        agent: "default",
      },
      fetchResponder: async () => ({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            ok: true,
            kind: "tx",
            transactionHash: "0x999",
            explorerUrl: "https://explorer.example/tx/0x999",
            replayed: true,
          }),
      }),
    });
    setHostedWalletConfig(harness, "ops");
    harness.deps.readStdin = async () =>
      JSON.stringify({
        projectId: "42",
        amount: "1500000000000000000",
        beneficiary: BENEFICIARY,
        network: "base-mainnet",
        agent: "ops",
        idempotencyKey: EXPLICIT_UUID,
      });
    mocks.buildCommunityTerminalPayPlanMock.mockReturnValue(
      createPlan({
        token: "0x000000000000000000000000000000000000eeee",
      })
    );

    const result = await executeCommunityPayCommand(
      {
        inputStdin: true,
      },
      harness.deps
    );

    expect(mocks.buildCommunityTerminalPayPlanMock).toHaveBeenCalledWith({
      projectId: "42",
      amount: "1500000000000000000",
      beneficiary: BENEFICIARY,
      network: "base-mainnet",
    });

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
      agentKey: "ops",
      to: TERMINAL,
      data: "0xfeed",
      valueEth: "1.5",
    });
    expect(result).toMatchObject({
      ok: true,
      kind: "tx",
      transactionHash: "0x999",
      explorerUrl: "https://explorer.example/tx/0x999",
      replayed: true,
      idempotencyKey: EXPLICIT_UUID,
      walletMode: "hosted",
      family: "community",
      action: "community.pay",
      executedStepCount: 1,
    });
  });

  it("executes hosted approval then pay steps with deterministic child idempotency keys", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
        agent: "default",
      },
    });
    const plan = createPlan({
      approvalIncluded: true,
      amount: 25n,
      token: TOKEN,
      steps: [
        {
          kind: "erc20-approval",
          label: "Approve payment token for community terminal",
          tokenAddress: TOKEN,
          spenderAddress: TERMINAL,
          amount: "25",
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
            data: "0xcafe",
            valueEth: "0",
          },
        },
      ],
      transaction: {
        to: TERMINAL,
        data: "0xcafe",
        valueEth: "0",
      },
      writeContract: {
        address: TERMINAL,
        abi: [],
        functionName: "pay",
        args: [],
      },
    });
    const approvalKey = deriveProtocolPlanStepIdempotencyKey({
      rootIdempotencyKey: EXPLICIT_UUID,
      plan: plan as unknown as ProtocolExecutionPlanLike,
      step: plan.steps[0]! as unknown as ProtocolPlanStepLike,
      stepNumber: 1,
    });
    const payKey = deriveProtocolPlanStepIdempotencyKey({
      rootIdempotencyKey: EXPLICIT_UUID,
      plan: plan as unknown as ProtocolExecutionPlanLike,
      step: plan.steps[1]! as unknown as ProtocolPlanStepLike,
      stepNumber: 2,
    });
    harness.fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            ok: true,
            kind: "tx",
            transactionHash: "0xapprove",
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            ok: true,
            kind: "tx",
            transactionHash: "0xpay",
            explorerUrl: "https://explorer.example/tx/0xpay",
            replayed: true,
          }),
      });
    mocks.buildCommunityTerminalPayPlanMock.mockReturnValue(plan);

    const result = await executeCommunityPayCommand(
      {
        inputJson: JSON.stringify({
          projectId: "42",
          token: TOKEN,
          amount: "25",
          beneficiary: BENEFICIARY,
          idempotencyKey: EXPLICIT_UUID,
        }),
      },
      harness.deps
    );

    expect(harness.fetchMock).toHaveBeenCalledTimes(2);

    const [, approvalInit] = harness.fetchMock.mock.calls[0] ?? [];
    const approvalHeaders = (approvalInit?.headers ?? {}) as Record<string, string>;
    expect(approvalHeaders["X-Idempotency-Key"]).toBe(approvalKey);
    expect(JSON.parse(String(approvalInit?.body))).toMatchObject({
      kind: "tx",
      network: "base",
      agentKey: "default",
      to: TOKEN,
      data: "0xaaaa",
      valueEth: "0",
    });

    const [, payInit] = harness.fetchMock.mock.calls[1] ?? [];
    const payHeaders = (payInit?.headers ?? {}) as Record<string, string>;
    expect(payHeaders["X-Idempotency-Key"]).toBe(payKey);
    expect(JSON.parse(String(payInit?.body))).toMatchObject({
      kind: "tx",
      network: "base",
      agentKey: "default",
      to: TERMINAL,
      data: "0xcafe",
      valueEth: "0",
    });

    expect(result).toMatchObject({
      ok: true,
      family: "community",
      action: "community.pay",
      idempotencyKey: EXPLICIT_UUID,
      approvalIncluded: true,
      transactionHash: "0xpay",
      explorerUrl: "https://explorer.example/tx/0xpay",
      replayed: true,
      kind: "tx",
      stepCount: 2,
      executedStepCount: 2,
      replayedStepCount: 1,
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
          replayed: true,
        },
      ],
    });
  });

  it("routes local wallet execution through executeLocalTx", async () => {
    const harness = createHarness({
      config: {
        agent: "default",
      },
    });
    setLocalWalletConfig(harness);
    harness.files.set(
      "/tmp/community-pay.json",
      JSON.stringify({
        projectId: "42",
        amount: "500",
        beneficiary: BENEFICIARY,
      })
    );
    mocks.buildCommunityTerminalPayPlanMock.mockReturnValue(
      createPlan({
        amount: 500n,
        steps: [
          {
            kind: "contract-call",
            contract: "CobuildCommunityTerminal",
            functionName: "pay",
            label: "Pay community terminal",
            transaction: {
              to: TERMINAL,
              data: "0xbeef",
              valueEth: "0",
            },
          },
        ],
        transaction: {
          to: TERMINAL,
          data: "0xbeef",
          valueEth: "0",
        },
        writeContract: {
          address: TERMINAL,
          abi: [],
          functionName: "pay",
          args: [],
        },
      })
    );
    mocks.executeLocalTxMock.mockResolvedValue({
      ok: true,
      kind: "tx",
      transactionHash: "0x123",
    });

    const result = await executeCommunityPayCommand(
      {
        inputFile: "/tmp/community-pay.json",
      },
      harness.deps
    );

    expect(mocks.executeLocalTxMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agentKey: "default",
        network: "base",
        to: TERMINAL,
        data: "0xbeef",
        valueEth: "0",
        idempotencyKey: expect.any(String),
      })
    );
    const localInput = mocks.executeLocalTxMock.mock.calls[0]?.[0] as {
      idempotencyKey: string;
    };
    expect(localInput.idempotencyKey).not.toBe("8e03978e-40d5-43e8-bc93-6894a57f9324");
    expect(result).toMatchObject({
      ok: true,
      kind: "tx",
      transactionHash: "0x123",
      idempotencyKey: "8e03978e-40d5-43e8-bc93-6894a57f9324",
      walletMode: "local",
      amount: "500",
      family: "community",
      action: "community.pay",
      executedStepCount: 1,
    });
    expect(harness.fetchMock).not.toHaveBeenCalled();
  });

  it("preserves approval and pay steps from the shared planner during dry-run", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
    });
    mocks.buildCommunityTerminalPayPlanMock.mockReturnValue(
      createPlan({
        approvalIncluded: true,
        amount: 25n,
        token: TOKEN,
        steps: [
          {
            kind: "erc20-approval",
            label: "Approve payment token for community terminal",
            tokenAddress: TOKEN,
            spenderAddress: TERMINAL,
            amount: "25",
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
              data: "0xcafe",
              valueEth: "0",
            },
          },
        ],
        transaction: {
          to: TERMINAL,
          data: "0xcafe",
          valueEth: "0",
        },
        writeContract: {
          address: TERMINAL,
          abi: [],
          functionName: "pay",
          args: [],
        },
      })
    );

    const result = await executeCommunityPayCommand(
      {
        inputJson: JSON.stringify({
          projectId: "42",
          token: TOKEN,
          amount: "25",
          beneficiary: BENEFICIARY,
        }),
        dryRun: true,
      },
      harness.deps
    );

    expect(result).toMatchObject({
      ok: true,
      dryRun: true,
      approvalIncluded: true,
      stepCount: 2,
      steps: [
        {
          stepNumber: 1,
          kind: "erc20-approval",
          request: {
            kind: "tx",
            to: TOKEN,
            valueEth: "0",
          },
        },
        {
          stepNumber: 2,
          kind: "contract-call",
          request: {
            kind: "tx",
            to: TERMINAL,
            valueEth: "0",
          },
        },
      ],
      request: {
        method: "POST",
        path: "/api/cli/exec",
        body: {
          kind: "tx",
          to: TERMINAL,
          valueEth: "0",
        },
      },
    });
  });

  it("rejects missing or malformed JSON input", async () => {
    const harness = createHarness();

    await expect(executeCommunityPayCommand({}, harness.deps)).rejects.toThrow(
      "Usage: cli community pay --input-json <json>|--input-file <path>|--input-stdin [--dry-run]\ncommunity pay input is required."
    );

    await expect(
      executeCommunityPayCommand(
        {
          inputJson: JSON.stringify({
            projectId: "42",
            amount: "1",
            beneficiary: BENEFICIARY,
            route: [],
          }),
        },
        harness.deps
      )
    ).rejects.toThrow('community pay input "route" must be an object when provided.');

    await expect(
      executeCommunityPayCommand(
        {
          inputJson: JSON.stringify({
            projectId: "42",
            amount: "1",
            beneficiary: BENEFICIARY,
            route: {
              goalIds: ["7", { bad: true }],
            },
          }),
        },
        harness.deps
      )
    ).rejects.toThrow('community pay input "route.goalIds[1]" must be a string or integer.');
  });
});
