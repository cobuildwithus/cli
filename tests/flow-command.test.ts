import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildFlowClearStaleAllocationPlan,
  buildFlowSyncAllocationForAccountPlan,
  buildFlowSyncAllocationPlan,
} from "@cobuild/wire";
import { runCli } from "../src/cli.js";
import {
  executeFlowClearStaleAllocationCommand,
  executeFlowSyncAllocationCommand,
  executeFlowSyncAllocationForAccountCommand,
} from "../src/commands/protocol-participant-flow.js";
import { participantProtocolWriteOutputSchema } from "../src/incur/commands/protocol-participant.command-shared.js";
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
const FLOW = "0x00000000000000000000000000000000000000aa";
const ACCOUNT = "0x00000000000000000000000000000000000000bb";

function parseLastJsonOutput(outputs: string[]): Record<string, unknown> {
  return JSON.parse(outputs.at(-1) ?? "{}") as Record<string, unknown>;
}

type PlannedFlowStep = {
  kind: string;
  transaction: {
    to: string;
    data: string;
    valueEth: string;
  };
} & Record<string, unknown>;

function requireSingleStep(plan: { steps: readonly PlannedFlowStep[] }): PlannedFlowStep {
  const step = plan.steps[0];
  if (!step) {
    throw new Error("expected flow plan to contain a step");
  }
  return step;
}

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

describe("flow commands", () => {
  beforeEach(() => {
    localExecMocks.executeLocalTxMock.mockReset();
  });

  it("supports sync-allocation dry-run and schema metadata", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
    });

    await runCli(
      [
        "flow",
        "sync-allocation",
        "--flow",
        FLOW,
        "--allocation-key",
        "12",
        "--dry-run",
      ],
      harness.deps
    );

    const expectedPlan = buildFlowSyncAllocationPlan({
      flowAddress: FLOW,
      allocationKey: 12n,
    });
    const expectedStep = requireSingleStep(expectedPlan);
    const output = parseLastJsonOutput(harness.outputs);

    expect(() => participantProtocolWriteOutputSchema.parse(output)).not.toThrow();
    expect(output).toMatchObject({
      ok: true,
      dryRun: true,
      family: "flow",
      action: expectedPlan.action,
      riskClass: expectedPlan.riskClass,
      stepCount: 1,
      executedStepCount: 0,
      steps: [
        {
          kind: "contract-call",
          functionName: "syncAllocation",
          transaction: expectedStep.transaction,
          request: {
            kind: "protocol-step",
            action: expectedPlan.action,
            step: expectedStep,
          },
        },
      ],
    });
    expect(harness.fetchMock).not.toHaveBeenCalled();

    await runCli(["schema", "flow", "sync-allocation"], harness.deps);

    expect(parseLastJsonOutput(harness.outputs)).toMatchObject({
      ok: true,
      command: "flow sync-allocation",
      schema: {
        options: {
          required: expect.arrayContaining(["flow", "allocationKey"]),
          properties: {
            flow: expect.any(Object),
            allocationKey: expect.any(Object),
            dryRun: expect.any(Object),
          },
        },
        output: {
          properties: {
            family: expect.any(Object),
            action: expect.any(Object),
            steps: expect.any(Object),
          },
        },
      },
      metadata: {
        mutating: true,
        supportsDryRun: true,
        requiresAuth: true,
        sideEffects: ["network", "onchain_transaction"],
      },
    });

    await runCli(["schema", "flow", "sync-allocation-for-account"], harness.deps);

    expect(parseLastJsonOutput(harness.outputs)).toMatchObject({
      ok: true,
      command: "flow sync-allocation-for-account",
      schema: {
        options: {
          required: expect.arrayContaining(["flow", "account"]),
          properties: {
            flow: expect.any(Object),
            account: expect.any(Object),
          },
        },
      },
      metadata: {
        mutating: true,
        supportsDryRun: true,
        requiresAuth: true,
        sideEffects: ["network", "onchain_transaction"],
      },
    });

    await runCli(["schema", "flow", "clear-stale-allocation"], harness.deps);

    expect(parseLastJsonOutput(harness.outputs)).toMatchObject({
      ok: true,
      command: "flow clear-stale-allocation",
      schema: {
        options: {
          required: expect.arrayContaining(["flow", "allocationKey"]),
          properties: {
            flow: expect.any(Object),
            allocationKey: expect.any(Object),
          },
        },
      },
      metadata: {
        mutating: true,
        supportsDryRun: true,
        requiresAuth: true,
        sideEffects: ["network", "onchain_transaction"],
      },
    });
  });

  it("routes sync-allocation-for-account through one local wallet execution", async () => {
    const harness = createHarness({
      config: {
        agent: "default",
      },
    });
    setLocalWalletConfig(harness);
    localExecMocks.executeLocalTxMock.mockResolvedValue({
      ok: true,
      kind: "tx",
      transactionHash: "0x5",
    });

    await runCli(
      [
        "flow",
        "sync-allocation-for-account",
        "--flow",
        FLOW,
        "--account",
        ACCOUNT,
        "--idempotency-key",
        EXPLICIT_UUID,
      ],
      harness.deps
    );

    const expectedPlan = buildFlowSyncAllocationForAccountPlan({
      flowAddress: FLOW,
      account: ACCOUNT,
    });
    const expectedStep = requireSingleStep(expectedPlan);
    expect(localExecMocks.executeLocalTxMock).toHaveBeenCalledTimes(1);
    const output = parseLastJsonOutput(harness.outputs);
    const outputSteps = output.steps as Array<Record<string, unknown>>;
    expect(localExecMocks.executeLocalTxMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agentKey: "default",
        network: "base",
        idempotencyKey: outputSteps[0]?.idempotencyKey,
        to: expectedStep.transaction?.to,
        data: expectedStep.transaction?.data,
        valueEth: expectedStep.transaction?.valueEth,
      })
    );
    expect(output).toMatchObject({
      ok: true,
      family: "flow",
      action: expectedPlan.action,
      executedStepCount: 1,
      walletMode: "local",
      steps: [
        {
          executionTarget: "local_wallet",
          request: {
            kind: "tx",
            to: expectedStep.transaction?.to,
            data: expectedStep.transaction?.data,
            valueEth: expectedStep.transaction?.valueEth,
          },
        },
      ],
    });
    expect(harness.fetchMock).not.toHaveBeenCalled();
  });

  it("routes clear-stale-allocation through hosted execution", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
      fetchResponder: async (input, init) => {
        expect(String(input)).toBe("https://api.example/api/cli/exec");
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect(body.kind).toBe("protocol-plan");
        expect(body.action).toBe("flow.clear-stale-allocation");
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              ok: true,
              transactionHash: "0xabc",
              explorerUrl: "https://explorer.example/tx/0xabc",
            }),
        };
      },
    });

    await runCli(
      [
        "flow",
        "clear-stale-allocation",
        "--flow",
        FLOW,
        "--allocation-key",
        "7",
        "--idempotency-key",
        EXPLICIT_UUID,
      ],
      harness.deps
    );

    const expectedPlan = buildFlowClearStaleAllocationPlan({
      flowAddress: FLOW,
      allocationKey: 7n,
    });
    const expectedStep = requireSingleStep(expectedPlan);
    const output = parseLastJsonOutput(harness.outputs);
    expect(harness.fetchMock).toHaveBeenCalledTimes(1);
    const [input, init] = harness.fetchMock.mock.calls[0] ?? [];
    expect(String(input)).toBe("https://api.example/api/cli/exec");
    expect(init?.headers).toMatchObject({
      "X-Idempotency-Key": output.idempotencyKey,
      "Idempotency-Key": output.idempotencyKey,
      authorization: "Bearer bbt_secret",
    });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      kind: "protocol-plan",
      network: "base",
      action: expectedPlan.action,
      riskClass: expectedPlan.riskClass,
      agentKey: "default",
      steps: [expectedStep],
    });

    expect(output).toMatchObject({
      ok: true,
      family: "flow",
      action: expectedPlan.action,
      riskClass: expectedPlan.riskClass,
      stepCount: 1,
      executedStepCount: 1,
      execution: {
        mode: "hosted-batch",
        atomic: true,
        idempotencyKey: EXPLICIT_UUID,
      },
      steps: [
        {
          executionTarget: "hosted_api",
          status: "succeeded",
          request: {
            kind: "protocol-step",
            action: expectedPlan.action,
            step: expectedStep,
          },
          transactionHash: "0xabc",
        },
      ],
    });
  });

  it("validates required flow command options", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
    });

    await expect(
      executeFlowSyncAllocationCommand(
        {
          flow: FLOW,
          dryRun: true,
        },
        harness.deps
      )
    ).rejects.toThrow("--allocation-key is required.");

    await expect(
      executeFlowSyncAllocationForAccountCommand(
        {
          flow: FLOW,
          dryRun: true,
        },
        harness.deps
      )
    ).rejects.toThrow("--account is required.");

    await expect(
      executeFlowClearStaleAllocationCommand(
        {
          allocationKey: "1",
          dryRun: true,
        },
        harness.deps
      )
    ).rejects.toThrow("--flow is required.");
  });
});
