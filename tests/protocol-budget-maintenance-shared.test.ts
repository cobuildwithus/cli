import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BudgetMaintenancePlan } from "@cobuild/wire";
import {
  executeBudgetMaintenancePlan,
  requireString,
  requireStringArray,
} from "../src/commands/protocol-budget-maintenance/shared.js";
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
const TOKEN = "0x00000000000000000000000000000000000000aa";

function createHostedHarness() {
  return createHarness({
    config: {
      url: "https://api.example",
      token: "bbt_secret",
    },
  });
}

function createBasePlan(step: BudgetMaintenancePlan["steps"][number]): BudgetMaintenancePlan {
  return {
    family: "budget",
    action: "syncBudgetTreasuries",
    controllerAddress: CONTROLLER,
    network: "base",
    riskClass: "maintenance",
    summary: "Budget maintenance test plan",
    preconditions: [],
    steps: [step],
    expectedEvents: [],
  };
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

describe("budget maintenance shared runtime", () => {
  beforeEach(() => {
    localExecMocks.executeLocalTxMock.mockReset();
  });

  it("normalizes required string helpers", () => {
    expect(requireString("  hello  ", "usage", "--value")).toBe("hello");
    expect(() => requireString("   ", "usage", "--value")).toThrow("usage\n--value is required.");

    expect(requireStringArray(["  a  ", "b"], "usage", "--item-id")).toEqual(["a", "b"]);
    expect(() => requireStringArray(["   "], "usage", "--item-id")).toThrow(
      "usage\n--item-id is required."
    );
  });

  it("renders approval steps correctly in dry-run mode", async () => {
    const harness = createHostedHarness();
    const plan = createBasePlan({
      kind: "erc20-approval",
      label: "Approve token",
      tokenAddress: TOKEN,
      spenderAddress: CONTROLLER,
      amount: "5",
      transaction: {
        to: TOKEN,
        data: "0x1234",
        valueEth: "0",
      },
    });

    const output = await executeBudgetMaintenancePlan({
      deps: harness.deps,
      input: {
        dryRun: true,
        idempotencyKey: EXPLICIT_UUID,
      },
      outputAction: "budget.sync",
      plan,
    });

    expect(output).toMatchObject({
      ok: true,
      dryRun: true,
      family: "budget",
      action: "budget.sync",
    });
    expect(output.steps).toMatchObject([
      {
        kind: "erc20-approval",
        tokenAddress: TOKEN.toLowerCase(),
        spenderAddress: CONTROLLER.toLowerCase(),
        amount: "5",
      },
    ]);
  });

  it("surfaces hosted pending responses with replay-safe guidance", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
      fetchResponder: async () => ({
        ok: true,
        status: 202,
        text: async () =>
          JSON.stringify({
            ok: true,
            pending: true,
            status: "pending",
            userOpHash: "0xpending-user-op",
          }),
      }),
    });
    const plan = createBasePlan({
      kind: "contract-call",
      label: "Sync budget treasuries",
      contract: "BudgetTCR",
      functionName: "syncBudgetTreasuries",
      transaction: {
        to: CONTROLLER,
        data: "0x1234",
        valueEth: "0",
      },
    });

    await expect(
      executeBudgetMaintenancePlan({
        deps: harness.deps,
        input: {
          idempotencyKey: EXPLICIT_UUID,
        },
        outputAction: "budget.sync",
        plan,
      })
    ).rejects.toThrow("still pending on the hosted wallet");
  });

  it("propagates explorer and replay metadata from local execution", async () => {
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
      explorerUrl: "https://basescan.org/tx/0x2",
      replayed: true,
    });
    const plan = createBasePlan({
      kind: "contract-call",
      label: "Prune terminal budget recipient",
      contract: "BudgetTCR",
      functionName: "pruneTerminalBudget",
      transaction: {
        to: CONTROLLER,
        data: "0x1234",
        valueEth: "0",
      },
    });

    const output = await executeBudgetMaintenancePlan({
      deps: harness.deps,
      input: {
        idempotencyKey: EXPLICIT_UUID,
      },
      outputAction: "budget.prune",
      plan,
    });

    expect(output.steps).toMatchObject([
      {
        kind: "contract-call",
        transactionHash: "0x2",
        explorerUrl: "https://basescan.org/tx/0x2",
        replayed: true,
      },
    ]);
  });
});
