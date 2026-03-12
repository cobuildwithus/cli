import { beforeEach, describe, expect, it, vi } from "vitest";
import { runCli } from "../src/cli.js";
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
const CONTROLLER = "0x000000000000000000000000000000000000dead";
const BUDGET_TREASURY = "0x00000000000000000000000000000000000000aa";
const ITEM_ID_A = `0x${"11".repeat(32)}`;
const ITEM_ID_B = `0x${"22".repeat(32)}`;

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

function parseLastJsonOutput(outputs: string[]): Record<string, unknown> {
  return JSON.parse(outputs.at(-1) ?? "{}") as Record<string, unknown>;
}

function createHostedHarness() {
  return createHarness({
    config: {
      url: "https://api.example",
      token: "bbt_secret",
    },
  });
}

describe("budget maintenance commands", () => {
  beforeEach(() => {
    localExecMocks.executeLocalTxMock.mockReset();
  });

  it("supports dry-run budget activate", async () => {
    const harness = createHostedHarness();

    await runCli(
      [
        "budget",
        "activate",
        "--controller",
        CONTROLLER,
        "--item-id",
        ITEM_ID_A,
        "--idempotency-key",
        EXPLICIT_UUID,
        "--dry-run",
      ],
      harness.deps
    );

    const output = parseLastJsonOutput(harness.outputs);
    expect(output).toMatchObject({
      ok: true,
      dryRun: true,
      family: "budget",
      action: "budget.activate",
      riskClass: "maintenance",
      network: "base",
    });
    expect(output.steps).toMatchObject([
      {
        stepNumber: 1,
        kind: "contract-call",
        request: {
          kind: "tx",
          to: CONTROLLER.toLowerCase(),
        },
      },
    ]);
  });

  it("routes hosted finalize-removed through raw tx execution", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
      fetchResponder: async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true, transactionHash: "0x1" }),
      }),
    });

    await runCli(
      [
        "budget",
        "finalize-removed",
        "--controller",
        CONTROLLER,
        "--item-id",
        ITEM_ID_A,
        "--idempotency-key",
        EXPLICIT_UUID,
      ],
      harness.deps
    );

    expect(harness.fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = harness.fetchMock.mock.calls[0]!;
    expect(init?.headers).toMatchObject({
      "X-Idempotency-Key": (parseLastJsonOutput(harness.outputs).steps as Array<Record<string, unknown>>)[0]
        ?.idempotencyKey,
      "Idempotency-Key": (parseLastJsonOutput(harness.outputs).steps as Array<Record<string, unknown>>)[0]
        ?.idempotencyKey,
    });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      kind: "tx",
      network: "base",
      agentKey: "default",
      to: CONTROLLER.toLowerCase(),
    });
    expect(parseLastJsonOutput(harness.outputs)).toMatchObject({
      ok: true,
      family: "budget",
      action: "budget.finalize-removed",
      executedStepCount: 1,
    });
  });

  it("accepts repeated item-id values for budget sync dry-run", async () => {
    const harness = createHostedHarness();

    await runCli(
      [
        "budget",
        "sync",
        "--controller",
        CONTROLLER,
        "--item-id",
        ITEM_ID_A,
        "--item-id",
        ITEM_ID_B,
        "--dry-run",
      ],
      harness.deps
    );

    const output = parseLastJsonOutput(harness.outputs);
    expect(output).toMatchObject({
      ok: true,
      dryRun: true,
      family: "budget",
      action: "budget.sync",
    });
    expect(output.steps).toMatchObject([
      {
        stepNumber: 1,
        kind: "contract-call",
        request: {
          kind: "tx",
          to: CONTROLLER.toLowerCase(),
        },
      },
    ]);
  });

  it("routes local prune through one local tx execution", async () => {
    const harness = createHarness({
      config: {
        agent: "default",
      },
    });
    setLocalWalletConfig(harness);
    localExecMocks.executeLocalTxMock.mockResolvedValue({
      ok: true,
      kind: "tx",
      transactionHash: "0x2",
    });

    await runCli(
      [
        "budget",
        "prune",
        "--controller",
        CONTROLLER,
        "--budget-treasury",
        BUDGET_TREASURY,
        "--idempotency-key",
        EXPLICIT_UUID,
      ],
      harness.deps
    );

    expect(localExecMocks.executeLocalTxMock).toHaveBeenCalledTimes(1);
    expect(localExecMocks.executeLocalTxMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agentKey: "default",
        network: "base",
        to: CONTROLLER.toLowerCase(),
      })
    );
    expect(parseLastJsonOutput(harness.outputs)).toMatchObject({
      ok: true,
      family: "budget",
      action: "budget.prune",
      executedStepCount: 1,
    });
  });

  it("supports dry-run budget retry-resolution", async () => {
    const harness = createHostedHarness();

    await runCli(
      [
        "budget",
        "retry-resolution",
        "--controller",
        CONTROLLER,
        "--item-id",
        ITEM_ID_A,
        "--dry-run",
      ],
      harness.deps
    );

    expect(parseLastJsonOutput(harness.outputs)).toMatchObject({
      ok: true,
      dryRun: true,
      family: "budget",
      action: "budget.retry-resolution",
    });
  });
});
