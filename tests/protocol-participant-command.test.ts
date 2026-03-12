import { describe, expect, it, vi, beforeEach } from "vitest";
import { erc20Abi } from "viem";
import {
  buildApprovalPlan,
  buildGoalStakeDepositPlan,
  buildProtocolCallStep,
  buildUnderwriterWithdrawalPreparationPlan,
} from "@cobuild/wire";
import { runCli } from "../src/cli.js";
import {
  executeParticipantProtocolPlan,
} from "../src/commands/protocol-participant-runtime.js";
import {
  executePremiumCheckpointCommand,
  executeStakeDepositCobuildCommand,
  executeStakeDepositGoalCommand,
  executeStakeFinalizeJurorExitCommand,
  executeStakeOptInJurorCommand,
  executeStakePrepareUnderwriterWithdrawalCommand,
  executeStakeRequestJurorExitCommand,
  executeStakeSetJurorDelegateCommand,
} from "../src/commands/protocol-participant-stake-premium.js";
import {
  executeTcrChallengeCommand,
  executeTcrEvidenceCommand,
  executeTcrRemoveCommand,
  executeTcrSubmitBudgetCommand,
  executeTcrSubmitMechanismCommand,
  executeTcrSubmitRoundSubmissionCommand,
  executeVoteCommitCommand,
  executeVoteCommitForCommand,
} from "../src/commands/protocol-participant-governance.js";
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
const REGISTRY = "0x000000000000000000000000000000000000dead";
const TOKEN = "0x00000000000000000000000000000000000000aa";
const ARBITRATOR = "0x00000000000000000000000000000000000000bb";
const RECIPIENT = "0x00000000000000000000000000000000000000cc";
const ITEM_ID = `0x${"11".repeat(32)}`;
const SALT = `0x${"22".repeat(32)}`;

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

function buildTcrCosts(): Record<string, string> {
  return {
    addItemCost: "123",
    removeItemCost: "234",
    challengeSubmissionCost: "345",
    challengeRemovalCost: "456",
    arbitrationCost: "567",
  };
}

function buildPendingStakePlan() {
  const plan = buildGoalStakeDepositPlan({
    network: "base",
    stakeVaultAddress: REGISTRY,
    goalTokenAddress: TOKEN,
    amount: "2",
    approvalMode: "force",
  });

  return {
    ...plan,
    summary: "Pending hosted plan",
    steps: plan.steps.map((step, index) => ({
      ...step,
      label: index === 0 ? "Approve token" : "Deposit stake",
    })),
  };
}

function buildCoveragePlan() {
  return buildUnderwriterWithdrawalPreparationPlan({
    network: "base",
    stakeVaultAddress: REGISTRY,
    maxBudgets: 3,
  });
}

function buildBudgetSubmissionInput(
  options: { withOverrides?: boolean } = {}
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    registry: REGISTRY,
    depositToken: TOKEN,
    listing: {
      metadata: {
        title: "Budget A",
        description: "Build protocol stuff",
        image: "ipfs://budget",
      },
      fundingDeadline: "10",
      executionDuration: "20",
      activationThreshold: "30",
      runwayCap: "40",
      oracleConfig: {
        oracleSpecHash: `0x${"33".repeat(32)}`,
        assertionPolicyHash: `0x${"44".repeat(32)}`,
      },
    },
    costs: buildTcrCosts(),
  };
  if (options.withOverrides !== false) {
    payload.network = "base";
    payload.agent = "default";
    payload.idempotencyKey = EXPLICIT_UUID;
  }
  return payload;
}

function buildMechanismSubmissionInput(
  options: { withOverrides?: boolean } = {}
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    registry: REGISTRY,
    depositToken: TOKEN,
    listing: {
      metadata: {
        title: "Mechanism A",
        description: "Allocate with rules",
        image: "ipfs://mechanism",
      },
      duration: "20",
      fundingDeadline: "10",
      minBudgetFunding: "30",
      maxBudgetFunding: "40",
      deploymentConfig: {
        mechanismFactory: REGISTRY,
      },
    },
    costs: buildTcrCosts(),
  };
  if (options.withOverrides !== false) {
    payload.network = "base";
    payload.agent = "default";
    payload.idempotencyKey = EXPLICIT_UUID;
  }
  return payload;
}

function buildRoundSubmissionInput(
  options: { withOverrides?: boolean } = {}
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    registry: REGISTRY,
    depositToken: TOKEN,
    submission: {
      source: "1",
      postId: ITEM_ID,
      recipient: RECIPIENT,
    },
    costs: buildTcrCosts(),
  };
  if (options.withOverrides !== false) {
    payload.network = "base";
    payload.agent = "default";
    payload.idempotencyKey = EXPLICIT_UUID;
  }
  return payload;
}

async function runDryRunCommand(argv: string[]) {
  const harness = createHostedHarness();
  await runCli([...argv, "--dry-run"], harness.deps);
  return {
    harness,
    output: parseLastJsonOutput(harness.outputs),
  };
}

describe("protocol participant commands", () => {
  beforeEach(() => {
    localExecMocks.executeLocalTxMock.mockReset();
  });

  it("supports dry-run budget TCR submission with approval and call steps", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
    });

    await runCli(
      [
        "tcr",
        "submit-budget",
        "--input-json",
        JSON.stringify({
          registry: REGISTRY,
          depositToken: TOKEN,
          network: "base",
          agent: "default",
          idempotencyKey: EXPLICIT_UUID,
          listing: {
            metadata: {
              title: "Budget A",
              description: "Build protocol stuff",
              image: "ipfs://budget",
            },
            fundingDeadline: "10",
            executionDuration: "20",
            activationThreshold: "30",
            runwayCap: "40",
            oracleConfig: {
              oracleSpecHash: `0x${"33".repeat(32)}`,
              assertionPolicyHash: `0x${"44".repeat(32)}`,
            },
          },
          costs: {
            addItemCost: "123",
            removeItemCost: "234",
            challengeSubmissionCost: "345",
            challengeRemovalCost: "456",
            arbitrationCost: "567",
          },
        }),
        "--dry-run",
      ],
      harness.deps
    );

    const output = parseLastJsonOutput(harness.outputs);
    expect(output).toMatchObject({
      ok: true,
      dryRun: true,
      family: "tcr",
      action: "tcr.submit-budget",
      riskClass: "governance",
      network: "base",
      preconditions: [],
    });
    expect(output.steps).toMatchObject([
      {
        stepNumber: 1,
        kind: "erc20-approval",
        request: {
          kind: "protocol-step",
          action: "addItem",
          step: {
            kind: "erc20-approval",
            transaction: {
              to: TOKEN.toLowerCase(),
            },
          },
        },
      },
      {
        stepNumber: 2,
        kind: "contract-call",
        request: {
          kind: "protocol-step",
          action: "addItem",
          step: {
            kind: "contract-call",
            transaction: {
              to: REGISTRY.toLowerCase(),
            },
          },
        },
      },
    ]);
    expect(harness.fetchMock).not.toHaveBeenCalled();
  });

  it("routes TCR challenges through hosted execution with deterministic step idempotency keys", async () => {
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
        "tcr",
        "challenge",
        "--registry",
        REGISTRY,
        "--deposit-token",
        TOKEN,
        "--item-id",
        ITEM_ID,
        "--request-type",
        "registrationRequested",
        "--costs-json",
        JSON.stringify({
          addItemCost: "123",
          removeItemCost: "234",
          challengeSubmissionCost: "345",
          challengeRemovalCost: "456",
          arbitrationCost: "567",
        }),
        "--idempotency-key",
        EXPLICIT_UUID,
      ],
      harness.deps
    );

    expect(harness.fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = harness.fetchMock.mock.calls[0]!;
    const output = parseLastJsonOutput(harness.outputs);
    expect(init?.headers).toMatchObject({
      "X-Idempotency-Key": output.idempotencyKey,
      "Idempotency-Key": output.idempotencyKey,
    });
    expect(output).toMatchObject({
      ok: true,
      idempotencyKey: EXPLICIT_UUID,
      family: "tcr",
      action: "tcr.challenge",
      executedStepCount: 2,
      execution: {
        mode: "hosted-batch",
        atomic: true,
        idempotencyKey: EXPLICIT_UUID,
      },
    });
  });

  it("halts hosted execution when a step returns a pending user operation", async () => {
    const pendingPlan = buildPendingStakePlan();
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

    await expect(
      executeParticipantProtocolPlan({
        deps: harness.deps,
        family: "stake",
        input: {
          idempotencyKey: EXPLICIT_UUID,
        },
        plan: pendingPlan,
      })
    ).rejects.toThrow(
      `Hosted protocol plan is still pending (root idempotency key: ${EXPLICIT_UUID}, userOpHash: 0xpending-user-op). Re-run the same command with --idempotency-key ${EXPLICIT_UUID} to resume safely.`
    );

    expect(harness.fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects unsupported participant networks before hosted execution starts", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
    });
    const unsupportedNetworkPlan = buildPendingStakePlan();

    await expect(
      executeParticipantProtocolPlan({
        deps: harness.deps,
        family: "stake",
        input: {
          idempotencyKey: EXPLICIT_UUID,
          network: "base-sepolia",
        },
        plan: {
          ...unsupportedNetworkPlan,
          network: "base-sepolia",
        },
      })
    ).rejects.toThrow('Unsupported network "base-sepolia". Only "base" is supported.');

    expect(harness.fetchMock).not.toHaveBeenCalled();
  });

  it("computes arbitrator vote commit hashes during dry-run", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
    });

    await runCli(
      [
        "vote",
        "commit",
        "--arbitrator",
        ARBITRATOR,
        "--dispute-id",
        "1",
        "--round",
        "0",
        "--voter",
        RECIPIENT,
        "--choice",
        "2",
        "--salt",
        SALT,
        "--dry-run",
      ],
      harness.deps
    );

    const output = parseLastJsonOutput(harness.outputs);
    expect(output).toMatchObject({
      ok: true,
      dryRun: true,
      family: "vote",
      action: "vote.commit",
    });
    expect(output.steps).toMatchObject([
      {
        stepNumber: 1,
        kind: "contract-call",
        request: {
          kind: "protocol-step",
          step: {
            transaction: {
              to: ARBITRATOR.toLowerCase(),
            },
          },
        },
      },
    ]);
  });

  it("routes local stake deposits through two local tx executions", async () => {
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
        "stake",
        "deposit-goal",
        "--vault",
        REGISTRY,
        "--token",
        TOKEN,
        "--amount",
        "500",
        "--approval-mode",
        "force",
        "--idempotency-key",
        EXPLICIT_UUID,
      ],
      harness.deps
    );

    expect(localExecMocks.executeLocalTxMock).toHaveBeenCalledTimes(2);
    const output = parseLastJsonOutput(harness.outputs);
    const outputSteps = output.steps as Array<Record<string, unknown>>;
    expect(localExecMocks.executeLocalTxMock.mock.calls[0]?.[0]).toMatchObject({
      idempotencyKey: outputSteps[0]?.idempotencyKey,
      to: TOKEN.toLowerCase(),
    });
    expect(localExecMocks.executeLocalTxMock.mock.calls[1]?.[0]).toMatchObject({
      idempotencyKey: outputSteps[1]?.idempotencyKey,
      to: REGISTRY.toLowerCase(),
    });
    expect(output).toMatchObject({
      ok: true,
      family: "stake",
      action: "stake.deposit-goal",
      executedStepCount: 2,
    });
  });

  it("routes local juror delegate updates through one local tx execution", async () => {
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
        "stake",
        "set-juror-delegate",
        "--vault",
        REGISTRY,
        "--delegate",
        RECIPIENT,
        "--idempotency-key",
        EXPLICIT_UUID,
      ],
      harness.deps
    );

    expect(localExecMocks.executeLocalTxMock).toHaveBeenCalledTimes(1);
    const output = parseLastJsonOutput(harness.outputs);
    const outputSteps = output.steps as Array<Record<string, unknown>>;
    expect(localExecMocks.executeLocalTxMock.mock.calls[0]?.[0]).toMatchObject({
      idempotencyKey: outputSteps[0]?.idempotencyKey,
      to: REGISTRY.toLowerCase(),
    });
    expect(output).toMatchObject({
      ok: true,
      family: "stake",
      action: "stake.set-juror-delegate",
      executedStepCount: 1,
    });
  });

  it("routes premium claims through hosted execution", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
      fetchResponder: async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true, transactionHash: "0x3" }),
      }),
    });

    await runCli(
      [
        "premium",
        "claim",
        "--escrow",
        REGISTRY,
        "--recipient",
        RECIPIENT,
        "--idempotency-key",
        EXPLICIT_UUID,
      ],
      harness.deps
    );

    expect(harness.fetchMock).toHaveBeenCalledTimes(1);
    const output = parseLastJsonOutput(harness.outputs);
    expect(output).toMatchObject({
      ok: true,
      family: "premium",
      action: "premium.claim",
      executedStepCount: 1,
    });
  });

  it("covers the shared approval-plan branches and rethrows hosted failures with idempotency context", async () => {
    const noArgsStep = buildProtocolCallStep({
      contract: "ERC20",
      functionName: "totalSupply",
      label: "Read total supply",
      to: TOKEN,
      abi: erc20Abi,
    });
    expect(noArgsStep.transaction.data).toMatch(/^0x/);

    expect(
      buildApprovalPlan({
        mode: "skip",
        tokenAddress: TOKEN,
        spenderAddress: REGISTRY,
        requiredAmount: "500",
        tokenLabel: "goal token",
        spenderLabel: "stake vault",
      })
    ).toMatchObject({
      approvalIncluded: false,
      steps: [],
      preconditions: [
        "Ensure goal token allowance for stake vault covers at least 500.",
      ],
    });

    expect(
      buildApprovalPlan({
        tokenAddress: TOKEN,
        spenderAddress: REGISTRY,
        requiredAmount: 500n,
        currentAllowance: 1n,
        approvalAmount: 700n,
        tokenLabel: "goal token",
        spenderLabel: "stake vault",
      })
    ).toMatchObject({
      approvalIncluded: true,
      preconditions: [],
    });

    expect(
      buildApprovalPlan({
        tokenAddress: TOKEN,
        spenderAddress: REGISTRY,
        requiredAmount: "500",
        tokenLabel: "goal token",
        spenderLabel: "stake vault",
      })
    ).toMatchObject({
      approvalIncluded: false,
      steps: [],
      preconditions: [
        "Ensure goal token allowance for stake vault covers at least 500.",
      ],
    });

    expect(
      buildApprovalPlan({
        tokenAddress: TOKEN,
        spenderAddress: REGISTRY,
        requiredAmount: "500",
        currentAllowance: "500",
        tokenLabel: "goal token",
        spenderLabel: "stake vault",
      })
    ).toMatchObject({
      approvalIncluded: false,
      preconditions: [],
      steps: [],
    });

    expect(() =>
      buildApprovalPlan({
        tokenAddress: TOKEN,
        spenderAddress: REGISTRY,
        requiredAmount: -1n,
        tokenLabel: "goal token",
        spenderLabel: "stake vault",
      })
    ).toThrow("requiredAmount must be a non-negative integer.");

    expect(() =>
      buildApprovalPlan({
        tokenAddress: TOKEN,
        spenderAddress: REGISTRY,
        requiredAmount: -1,
        tokenLabel: "goal token",
        spenderLabel: "stake vault",
      })
    ).toThrow("requiredAmount must be a non-negative integer.");

    expect(() =>
      buildApprovalPlan({
        tokenAddress: TOKEN,
        spenderAddress: REGISTRY,
        requiredAmount: "oops",
        tokenLabel: "goal token",
        spenderLabel: "stake vault",
      })
    ).toThrow("requiredAmount must be a non-negative integer.");

    const coveragePlan = buildCoveragePlan();

    const dryRunOutput = await executeParticipantProtocolPlan({
      deps: createHostedHarness().deps,
      family: "stake",
      input: {
        dryRun: true,
        idempotencyKey: EXPLICIT_UUID,
      },
      plan: coveragePlan,
    });
    expect(dryRunOutput.expectedEvents).toEqual([]);

    const dryRunWithDecoder = await executeParticipantProtocolPlan({
      deps: createHostedHarness().deps,
      family: "stake",
      input: {
        dryRun: true,
        idempotencyKey: EXPLICIT_UUID,
      },
      plan: coveragePlan,
      getStepReceiptDecoder: () => ({
        decode: () => ({ covered: true }),
      }),
    });
    expect(dryRunWithDecoder.family).toBe("stake");

    const successHarness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
      fetchResponder: async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true, transactionHash: "0x4" }),
      }),
    });
    const successOutput = await executeParticipantProtocolPlan({
      deps: successHarness.deps,
      family: "stake",
      input: {
        idempotencyKey: EXPLICIT_UUID,
      },
      plan: coveragePlan,
    });
    expect(successOutput.expectedEvents).toEqual([]);

    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
      fetchResponder: async () => ({
        ok: false,
        status: 503,
        text: async () => JSON.stringify({ error: "temporarily_unavailable" }),
      }),
    });

    await expect(
      executeParticipantProtocolPlan({
        deps: harness.deps,
        family: "stake",
        input: {
          idempotencyKey: EXPLICIT_UUID,
        },
        plan: coveragePlan,
      })
    ).rejects.toThrow(
      `Hosted protocol plan failed: Request failed (status 503): temporarily_unavailable (root idempotency key: ${EXPLICIT_UUID}). Re-run the same command with --idempotency-key ${EXPLICIT_UUID} to resume safely.`
    );
  });

  it("covers stake and premium validation branches without changing command behavior", async () => {
    const harness = createHostedHarness();

    await expect(
      executeStakePrepareUnderwriterWithdrawalCommand(
        { vault: REGISTRY, maxBudgets: 3n, dryRun: true },
        harness.deps
      )
    ).resolves.toMatchObject({
      ok: true,
      dryRun: true,
      action: "stake.prepare-underwriter-withdrawal",
    });

    await expect(
      executeStakePrepareUnderwriterWithdrawalCommand(
        { vault: REGISTRY, maxBudgets: -1n, dryRun: true },
        harness.deps
      )
    ).rejects.toThrow("maxBudgets must be a non-negative integer.");

    await expect(
      executeStakeDepositGoalCommand(
        {
          vault: REGISTRY,
          token: TOKEN,
          amount: "5",
          currentAllowance: "1",
          approvalAmount: "10",
          dryRun: true,
        },
        harness.deps
      )
    ).resolves.toMatchObject({
      ok: true,
      dryRun: true,
      action: "stake.deposit-goal",
    });

    await expect(
      executeStakeDepositGoalCommand(
        {
          vault: REGISTRY,
          token: TOKEN,
          amount: -1,
          dryRun: true,
        },
        harness.deps
      )
    ).rejects.toThrow("amount must be a non-negative integer.");

    await expect(
      executeStakeDepositGoalCommand(
        {
          vault: REGISTRY,
          token: TOKEN,
          amount: "oops",
          dryRun: true,
        },
        harness.deps
      )
    ).rejects.toThrow("amount must be a non-negative integer.");

    await expect(
      executeStakeOptInJurorCommand(
        {
          vault: REGISTRY,
          token: TOKEN,
          goalAmount: "5",
          delegate: RECIPIENT,
          currentAllowance: "1",
          approvalAmount: "10",
          dryRun: true,
        },
        harness.deps
      )
    ).resolves.toMatchObject({
      ok: true,
      dryRun: true,
      action: "stake.opt-in-juror",
    });

    await expect(
      executeStakeOptInJurorCommand(
        {
          vault: REGISTRY,
          token: TOKEN,
          goalAmount: -1,
          delegate: RECIPIENT,
          dryRun: true,
        },
        harness.deps
      )
    ).rejects.toThrow("goalAmount must be a non-negative integer.");

    await expect(
      executeStakeRequestJurorExitCommand(
        { vault: REGISTRY, dryRun: true },
        harness.deps
      )
    ).rejects.toThrow("--goal-amount is required.");

    await expect(
      executeStakeFinalizeJurorExitCommand(
        { dryRun: true },
        harness.deps
      )
    ).rejects.toThrow("--vault is required.");

    await expect(
      executeStakeSetJurorDelegateCommand(
        { vault: REGISTRY, dryRun: true },
        harness.deps
      )
    ).rejects.toThrow("--delegate is required.");

    await expect(
      executeStakePrepareUnderwriterWithdrawalCommand(
        { vault: REGISTRY, dryRun: true },
        harness.deps
      )
    ).rejects.toThrow("--max-budgets is required.");

    await expect(
      executeStakeDepositCobuildCommand(
        {
          vault: REGISTRY,
          token: TOKEN,
          amount: "5",
          approvalMode: "skip",
          dryRun: true,
        },
        harness.deps
      )
    ).resolves.toMatchObject({
      ok: true,
      dryRun: true,
      action: "stake.deposit-cobuild",
      preconditions: [
        "Ensure cobuild token allowance for stake vault covers at least 5.",
      ],
    });

    await expect(
      executePremiumCheckpointCommand(
        {
          escrow: REGISTRY,
          dryRun: true,
        },
        harness.deps
      )
    ).rejects.toThrow("--account is required.");
  });

  it("covers governance submit overrides and both commit-hash branches", async () => {
    const harness = createHostedHarness();

    await expect(
      executeTcrSubmitBudgetCommand(
        {
          inputJson: JSON.stringify(buildBudgetSubmissionInput({ withOverrides: false })),
          dryRun: true,
        },
        harness.deps
      )
    ).resolves.toMatchObject({
      ok: true,
      dryRun: true,
      action: "tcr.submit-budget",
      network: "base",
      agentKey: "default",
    });

    await expect(
      executeTcrSubmitMechanismCommand(
        {
          inputJson: JSON.stringify(buildMechanismSubmissionInput({ withOverrides: false })),
          dryRun: true,
        },
        harness.deps
      )
    ).resolves.toMatchObject({
      ok: true,
      dryRun: true,
      action: "tcr.submit-mechanism",
      network: "base",
      agentKey: "default",
    });

    await expect(
      executeTcrSubmitRoundSubmissionCommand(
        {
          inputJson: JSON.stringify(buildRoundSubmissionInput({ withOverrides: false })),
          dryRun: true,
        },
        harness.deps
      )
    ).resolves.toMatchObject({
      ok: true,
      dryRun: true,
      action: "tcr.submit-round-submission",
      network: "base",
      agentKey: "default",
    });

    await expect(
      executeVoteCommitCommand(
        {
          arbitrator: ARBITRATOR,
          disputeId: "1",
          commitHash: ITEM_ID,
          dryRun: true,
        },
        harness.deps
      )
    ).resolves.toMatchObject({
      ok: true,
      dryRun: true,
      action: "vote.commit",
    });

    await expect(
      executeVoteCommitForCommand(
        {
          arbitrator: ARBITRATOR,
          disputeId: "1",
          voter: RECIPIENT,
          round: "0",
          choice: "2",
          salt: SALT,
          dryRun: true,
        },
        harness.deps
      )
    ).resolves.toMatchObject({
      ok: true,
      dryRun: true,
      action: "vote.commit-for",
    });
  });

  it("rejects malformed governance payloads and required fields with strict errors", async () => {
    const harness = createHostedHarness();

    await expect(executeTcrSubmitBudgetCommand({}, harness.deps)).rejects.toThrow(
      "Budget TCR submit input is required."
    );

    const budgetMissingRegistry = structuredClone(buildBudgetSubmissionInput({ withOverrides: false }));
    delete budgetMissingRegistry.registry;
    await expect(
      executeTcrSubmitBudgetCommand(
        {
          inputJson: JSON.stringify(budgetMissingRegistry),
          dryRun: true,
        },
        harness.deps
      )
    ).rejects.toThrow("payload.registry is required.");

    const budgetMissingDepositToken = structuredClone(
      buildBudgetSubmissionInput({ withOverrides: false })
    );
    delete budgetMissingDepositToken.depositToken;
    await expect(
      executeTcrSubmitBudgetCommand(
        {
          inputJson: JSON.stringify(budgetMissingDepositToken),
          dryRun: true,
        },
        harness.deps
      )
    ).rejects.toThrow("payload.depositToken is required.");

    const budgetBadListing = structuredClone(buildBudgetSubmissionInput({ withOverrides: false }));
    budgetBadListing.listing = "bad";
    await expect(
      executeTcrSubmitBudgetCommand(
        {
          inputJson: JSON.stringify(budgetBadListing),
          dryRun: true,
        },
        harness.deps
      )
    ).rejects.toThrow("listing must be an object.");

    const budgetBadCosts = structuredClone(buildBudgetSubmissionInput({ withOverrides: false }));
    budgetBadCosts.costs = "bad";
    await expect(
      executeTcrSubmitBudgetCommand(
        {
          inputJson: JSON.stringify(budgetBadCosts),
          dryRun: true,
        },
        harness.deps
      )
    ).rejects.toThrow("costs must be an object.");

    const budgetBadMetadata = structuredClone(buildBudgetSubmissionInput({ withOverrides: false }));
    (budgetBadMetadata.listing as Record<string, unknown>).metadata = "bad";
    await expect(
      executeTcrSubmitBudgetCommand(
        {
          inputJson: JSON.stringify(budgetBadMetadata),
          dryRun: true,
        },
        harness.deps
      )
    ).rejects.toThrow("metadata must be an object.");

    const budgetBlankTitle = structuredClone(buildBudgetSubmissionInput({ withOverrides: false }));
    ((budgetBlankTitle.listing as Record<string, unknown>).metadata as Record<string, unknown>).title =
      "   ";
    await expect(
      executeTcrSubmitBudgetCommand(
        {
          inputJson: JSON.stringify(budgetBlankTitle),
          dryRun: true,
        },
        harness.deps
      )
    ).rejects.toThrow("metadata.title must be a non-empty string.");

    const budgetBadTagline = structuredClone(buildBudgetSubmissionInput({ withOverrides: false }));
    ((budgetBadTagline.listing as Record<string, unknown>).metadata as Record<string, unknown>).tagline =
      1;
    await expect(
      executeTcrSubmitBudgetCommand(
        {
          inputJson: JSON.stringify(budgetBadTagline),
          dryRun: true,
        },
        harness.deps
      )
    ).rejects.toThrow("metadata.tagline must be a string.");

    const budgetHugeDeadline = structuredClone(buildBudgetSubmissionInput({ withOverrides: false }));
    (budgetHugeDeadline.listing as Record<string, unknown>).fundingDeadline = (
      (1n << 64n)
    ).toString();
    await expect(
      executeTcrSubmitBudgetCommand(
        {
          inputJson: JSON.stringify(budgetHugeDeadline),
          dryRun: true,
        },
        harness.deps
      )
    ).rejects.toThrow("listing.fundingDeadline exceeds the supported range.");

    const mechanismMissingRegistry = structuredClone(
      buildMechanismSubmissionInput({ withOverrides: false })
    );
    delete mechanismMissingRegistry.registry;
    await expect(
      executeTcrSubmitMechanismCommand(
        {
          inputJson: JSON.stringify(mechanismMissingRegistry),
          dryRun: true,
        },
        harness.deps
      )
    ).rejects.toThrow("payload.registry is required.");

    const mechanismMissingDepositToken = structuredClone(
      buildMechanismSubmissionInput({ withOverrides: false })
    );
    delete mechanismMissingDepositToken.depositToken;
    await expect(
      executeTcrSubmitMechanismCommand(
        {
          inputJson: JSON.stringify(mechanismMissingDepositToken),
          dryRun: true,
        },
        harness.deps
      )
    ).rejects.toThrow("payload.depositToken is required.");

    const mechanismBadListing = structuredClone(
      buildMechanismSubmissionInput({ withOverrides: false })
    );
    mechanismBadListing.listing = "bad";
    await expect(
      executeTcrSubmitMechanismCommand(
        {
          inputJson: JSON.stringify(mechanismBadListing),
          dryRun: true,
        },
        harness.deps
      )
    ).rejects.toThrow("listing must be an object.");

    const mechanismLowMax = structuredClone(
      buildMechanismSubmissionInput({ withOverrides: false })
    );
    (mechanismLowMax.listing as Record<string, unknown>).minBudgetFunding = "50";
    (mechanismLowMax.listing as Record<string, unknown>).maxBudgetFunding = "40";
    await expect(
      executeTcrSubmitMechanismCommand(
        {
          inputJson: JSON.stringify(mechanismLowMax),
          dryRun: true,
        },
        harness.deps
      )
    ).rejects.toThrow(
      "listing.maxBudgetFunding must be zero or greater than or equal to minBudgetFunding."
    );

    const mechanismFundingMismatch = structuredClone(
      buildMechanismSubmissionInput({ withOverrides: false })
    );
    (mechanismFundingMismatch.listing as Record<string, unknown>).fundingDeadline = "0";
    (mechanismFundingMismatch.listing as Record<string, unknown>).minBudgetFunding = "1";
    await expect(
      executeTcrSubmitMechanismCommand(
        {
          inputJson: JSON.stringify(mechanismFundingMismatch),
          dryRun: true,
        },
        harness.deps
      )
    ).rejects.toThrow(
      "listing.fundingDeadline and listing.minBudgetFunding must either both be zero or both be set."
    );

    const mechanismBadConfig = structuredClone(
      buildMechanismSubmissionInput({ withOverrides: false })
    );
    (
      (mechanismBadConfig.listing as Record<string, unknown>).deploymentConfig as Record<
        string,
        unknown
      >
    ).mechanismConfig = "zz";
    await expect(
      executeTcrSubmitMechanismCommand(
        {
          inputJson: JSON.stringify(mechanismBadConfig),
          dryRun: true,
        },
        harness.deps
      )
    ).rejects.toThrow("listing.deploymentConfig.mechanismConfig must be valid hex bytes");

    const roundMissingRegistry = structuredClone(
      buildRoundSubmissionInput({ withOverrides: false })
    );
    delete roundMissingRegistry.registry;
    await expect(
      executeTcrSubmitRoundSubmissionCommand(
        {
          inputJson: JSON.stringify(roundMissingRegistry),
          dryRun: true,
        },
        harness.deps
      )
    ).rejects.toThrow("payload.registry is required.");

    const roundMissingDepositToken = structuredClone(
      buildRoundSubmissionInput({ withOverrides: false })
    );
    delete roundMissingDepositToken.depositToken;
    await expect(
      executeTcrSubmitRoundSubmissionCommand(
        {
          inputJson: JSON.stringify(roundMissingDepositToken),
          dryRun: true,
        },
        harness.deps
      )
    ).rejects.toThrow("payload.depositToken is required.");

    const roundBadSubmission = structuredClone(buildRoundSubmissionInput({ withOverrides: false }));
    roundBadSubmission.submission = "bad";
    await expect(
      executeTcrSubmitRoundSubmissionCommand(
        {
          inputJson: JSON.stringify(roundBadSubmission),
          dryRun: true,
        },
        harness.deps
      )
    ).rejects.toThrow("submission must be an object.");

    const roundSourceTooHigh = structuredClone(
      buildRoundSubmissionInput({ withOverrides: false })
    );
    (roundSourceTooHigh.submission as Record<string, unknown>).source = "256";
    await expect(
      executeTcrSubmitRoundSubmissionCommand(
        {
          inputJson: JSON.stringify(roundSourceTooHigh),
          dryRun: true,
        },
        harness.deps
      )
    ).rejects.toThrow("submission.source exceeds the supported range.");

    await expect(
      executeTcrRemoveCommand(
        {
          registry: REGISTRY,
          depositToken: TOKEN,
          itemId: ITEM_ID,
          dryRun: true,
        },
        harness.deps
      )
    ).rejects.toThrow("TCR costs are required.");

    await expect(
      executeTcrEvidenceCommand(
        {
          registry: REGISTRY,
          itemId: ITEM_ID,
          dryRun: true,
        },
        harness.deps
      )
    ).rejects.toThrow("--evidence is required.");

    await expect(
      executeTcrChallengeCommand(
        {
          registry: REGISTRY,
          depositToken: TOKEN,
          itemId: ITEM_ID,
          requestType: "foo",
          costsJson: JSON.stringify(buildTcrCosts()),
          dryRun: true,
        },
        harness.deps
      )
    ).rejects.toThrow("requestType must be registrationRequested (2) or clearingRequested (3).");

    await expect(
      executeTcrChallengeCommand(
        {
          registry: REGISTRY,
          depositToken: TOKEN,
          itemId: ITEM_ID,
          requestType: "4",
          costsJson: JSON.stringify(buildTcrCosts()),
          dryRun: true,
        },
        harness.deps
      )
    ).rejects.toThrow("requestType must be registrationRequested (2) or clearingRequested (3).");
  });

  it("skips approval transactions when stake deposits or juror opt-ins do not need one", async () => {
    const depositGoal = await runDryRunCommand([
      "stake",
      "deposit-goal",
      "--vault",
      REGISTRY,
      "--token",
      TOKEN,
      "--amount",
      "500",
    ]);
    expect(depositGoal.output).toMatchObject({
      ok: true,
      dryRun: true,
      family: "stake",
      action: "stake.deposit-goal",
      preconditions: [
        "Ensure goal token allowance for stake vault covers at least 500.",
      ],
    });
    expect(depositGoal.output.steps).toMatchObject([
      {
        kind: "contract-call",
        request: {
          kind: "protocol-step",
          step: {
            transaction: {
              to: REGISTRY.toLowerCase(),
            },
          },
        },
      },
    ]);
    expect(depositGoal.harness.fetchMock).not.toHaveBeenCalled();

    const depositCobuild = await runDryRunCommand([
      "stake",
      "deposit-cobuild",
      "--vault",
      REGISTRY,
      "--token",
      TOKEN,
      "--amount",
      "500",
      "--current-allowance",
      "500",
      "--approval-amount",
      "999",
    ]);
    expect(depositCobuild.output).toMatchObject({
      ok: true,
      dryRun: true,
      family: "stake",
      action: "stake.deposit-cobuild",
      preconditions: [],
    });
    expect(depositCobuild.output.steps).toMatchObject([
      {
        kind: "contract-call",
        request: {
          kind: "protocol-step",
          step: {
            transaction: {
              to: REGISTRY.toLowerCase(),
            },
          },
        },
      },
    ]);
    expect(depositCobuild.harness.fetchMock).not.toHaveBeenCalled();

    const optInJuror = await runDryRunCommand([
      "stake",
      "opt-in-juror",
      "--vault",
      REGISTRY,
      "--token",
      TOKEN,
      "--goal-amount",
      "13",
      "--delegate",
      RECIPIENT,
      "--current-allowance",
      "13",
      "--approval-amount",
      "999",
    ]);
    expect(optInJuror.output).toMatchObject({
      ok: true,
      dryRun: true,
      family: "stake",
      action: "stake.opt-in-juror",
      preconditions: [],
      expectedEvents: ["JurorOptedIn"],
    });
    expect(optInJuror.output.steps).toMatchObject([
      {
        kind: "contract-call",
        request: {
          kind: "protocol-step",
          step: {
            transaction: {
              to: REGISTRY.toLowerCase(),
            },
          },
        },
      },
    ]);
    expect(optInJuror.harness.fetchMock).not.toHaveBeenCalled();
  });

  it("supports dry-run juror opt-in with approval and contract-call steps", async () => {
    const optInJuror = await runDryRunCommand([
      "stake",
      "opt-in-juror",
      "--vault",
      REGISTRY,
      "--token",
      TOKEN,
      "--goal-amount",
      "13",
      "--delegate",
      RECIPIENT,
      "--approval-mode",
      "force",
    ]);

    expect(optInJuror.output).toMatchObject({
      ok: true,
      dryRun: true,
      family: "stake",
      action: "stake.opt-in-juror",
      preconditions: [],
      expectedEvents: ["JurorOptedIn"],
    });
    expect(optInJuror.output.steps).toMatchObject([
      {
        kind: "erc20-approval",
        request: {
          kind: "protocol-step",
          step: {
            transaction: {
              to: TOKEN.toLowerCase(),
            },
          },
        },
      },
      {
        kind: "contract-call",
        request: {
          kind: "protocol-step",
          step: {
            transaction: {
              to: REGISTRY.toLowerCase(),
            },
          },
        },
      },
    ]);
    expect(optInJuror.harness.fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "stake request-juror-exit",
      argv: [
        "stake",
        "request-juror-exit",
        "--vault",
        REGISTRY,
        "--goal-amount",
        "25",
      ],
      family: "stake",
      action: "stake.request-juror-exit",
      stepCount: 1,
      to: REGISTRY.toLowerCase(),
    },
    {
      label: "stake finalize-juror-exit",
      argv: [
        "stake",
        "finalize-juror-exit",
        "--vault",
        REGISTRY,
      ],
      family: "stake",
      action: "stake.finalize-juror-exit",
      stepCount: 1,
      to: REGISTRY.toLowerCase(),
    },
    {
      label: "stake set-juror-delegate",
      argv: [
        "stake",
        "set-juror-delegate",
        "--vault",
        REGISTRY,
        "--delegate",
        RECIPIENT,
      ],
      family: "stake",
      action: "stake.set-juror-delegate",
      stepCount: 1,
      to: REGISTRY.toLowerCase(),
    },
    {
      label: "stake prepare-underwriter-withdrawal",
      argv: [
        "stake",
        "prepare-underwriter-withdrawal",
        "--vault",
        REGISTRY,
        "--max-budgets",
        "3",
      ],
      family: "stake",
      action: "stake.prepare-underwriter-withdrawal",
      stepCount: 1,
      to: REGISTRY.toLowerCase(),
    },
    {
      label: "stake withdraw-goal",
      argv: [
        "stake",
        "withdraw-goal",
        "--vault",
        REGISTRY,
        "--amount",
        "25",
        "--recipient",
        RECIPIENT,
      ],
      family: "stake",
      action: "stake.withdraw-goal",
      stepCount: 1,
      to: REGISTRY.toLowerCase(),
    },
    {
      label: "stake withdraw-cobuild",
      argv: [
        "stake",
        "withdraw-cobuild",
        "--vault",
        REGISTRY,
        "--amount",
        "25",
        "--recipient",
        RECIPIENT,
      ],
      family: "stake",
      action: "stake.withdraw-cobuild",
      stepCount: 1,
      to: REGISTRY.toLowerCase(),
    },
    {
      label: "premium checkpoint",
      argv: [
        "premium",
        "checkpoint",
        "--escrow",
        REGISTRY,
        "--account",
        RECIPIENT,
      ],
      family: "premium",
      action: "premium.checkpoint",
      stepCount: 1,
      to: REGISTRY.toLowerCase(),
    },
    {
      label: "tcr submit-mechanism",
      argv: [
        "tcr",
        "submit-mechanism",
        "--input-json",
        JSON.stringify(buildMechanismSubmissionInput()),
      ],
      family: "tcr",
      action: "tcr.submit-mechanism",
      stepCount: 2,
      to: REGISTRY.toLowerCase(),
    },
    {
      label: "tcr submit-round-submission",
      argv: [
        "tcr",
        "submit-round-submission",
        "--input-json",
        JSON.stringify(buildRoundSubmissionInput()),
      ],
      family: "tcr",
      action: "tcr.submit-round-submission",
      stepCount: 2,
      to: REGISTRY.toLowerCase(),
    },
    {
      label: "tcr remove",
      argv: [
        "tcr",
        "remove",
        "--registry",
        REGISTRY,
        "--deposit-token",
        TOKEN,
        "--item-id",
        ITEM_ID,
        "--costs-json",
        JSON.stringify(buildTcrCosts()),
      ],
      family: "tcr",
      action: "tcr.remove",
      stepCount: 2,
      to: REGISTRY.toLowerCase(),
    },
    {
      label: "tcr challenge with numeric request type",
      argv: [
        "tcr",
        "challenge",
        "--registry",
        REGISTRY,
        "--deposit-token",
        TOKEN,
        "--item-id",
        ITEM_ID,
        "--request-type",
        "3",
        "--costs-json",
        JSON.stringify(buildTcrCosts()),
      ],
      family: "tcr",
      action: "tcr.challenge",
      stepCount: 2,
      to: REGISTRY.toLowerCase(),
    },
    {
      label: "tcr execute",
      argv: ["tcr", "execute", "--registry", REGISTRY, "--item-id", ITEM_ID],
      family: "tcr",
      action: "tcr.execute",
      stepCount: 1,
      to: REGISTRY.toLowerCase(),
    },
    {
      label: "tcr timeout",
      argv: ["tcr", "timeout", "--registry", REGISTRY, "--item-id", ITEM_ID],
      family: "tcr",
      action: "tcr.timeout",
      stepCount: 1,
      to: REGISTRY.toLowerCase(),
    },
    {
      label: "tcr evidence",
      argv: [
        "tcr",
        "evidence",
        "--registry",
        REGISTRY,
        "--item-id",
        ITEM_ID,
        "--evidence",
        "ipfs://evidence",
      ],
      family: "tcr",
      action: "tcr.evidence",
      stepCount: 1,
      to: REGISTRY.toLowerCase(),
    },
    {
      label: "tcr withdraw",
      argv: [
        "tcr",
        "withdraw",
        "--registry",
        REGISTRY,
        "--beneficiary",
        RECIPIENT,
        "--item-id",
        ITEM_ID,
        "--request-index",
        "0",
        "--round-index",
        "1",
      ],
      family: "tcr",
      action: "tcr.withdraw",
      stepCount: 1,
      to: REGISTRY.toLowerCase(),
    },
    {
      label: "vote commit-for with precomputed hash",
      argv: [
        "vote",
        "commit-for",
        "--arbitrator",
        ARBITRATOR,
        "--dispute-id",
        "1",
        "--voter",
        RECIPIENT,
        "--commit-hash",
        ITEM_ID,
      ],
      family: "vote",
      action: "vote.commit-for",
      stepCount: 1,
      to: ARBITRATOR.toLowerCase(),
    },
    {
      label: "vote reveal",
      argv: [
        "vote",
        "reveal",
        "--arbitrator",
        ARBITRATOR,
        "--dispute-id",
        "1",
        "--voter",
        RECIPIENT,
        "--choice",
        "2",
        "--salt",
        SALT,
      ],
      family: "vote",
      action: "vote.reveal",
      stepCount: 1,
      to: ARBITRATOR.toLowerCase(),
    },
    {
      label: "vote rewards",
      argv: [
        "vote",
        "rewards",
        "--arbitrator",
        ARBITRATOR,
        "--dispute-id",
        "1",
        "--round",
        "0",
        "--voter",
        RECIPIENT,
      ],
      family: "vote",
      action: "vote.rewards",
      stepCount: 1,
      to: ARBITRATOR.toLowerCase(),
    },
    {
      label: "vote invalid-round-rewards",
      argv: [
        "vote",
        "invalid-round-rewards",
        "--arbitrator",
        ARBITRATOR,
        "--dispute-id",
        "1",
        "--round",
        "0",
      ],
      family: "vote",
      action: "vote.invalid-round-rewards",
      stepCount: 1,
      to: ARBITRATOR.toLowerCase(),
    },
    {
      label: "vote execute-ruling",
      argv: [
        "vote",
        "execute-ruling",
        "--arbitrator",
        ARBITRATOR,
        "--dispute-id",
        "1",
      ],
      family: "vote",
      action: "vote.execute-ruling",
      stepCount: 1,
      to: ARBITRATOR.toLowerCase(),
    },
  ])("supports $label via dry-run", async ({ argv, family, action, stepCount, to }) => {
    const { harness, output } = await runDryRunCommand(argv);
    expect(output).toMatchObject({
      ok: true,
      dryRun: true,
      family,
      action,
    });

    expect(Array.isArray(output.steps)).toBe(true);
    const steps = output.steps as Array<Record<string, unknown>>;
    expect(steps).toHaveLength(stepCount);
    expect(steps.at(-1)).toMatchObject({
      request: {
        kind: "protocol-step",
        step: {
          transaction: {
            to,
          },
        },
      },
    });
    expect(harness.fetchMock).not.toHaveBeenCalled();
  });
});
