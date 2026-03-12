import { createServer } from "node:http";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Hex } from "viem";
import { buildGoalStakeDepositPlan } from "@cobuild/wire";
import {
  IDEMPOTENCY_DEPRECATED_HEADER,
  IDEMPOTENCY_PRIMARY_HEADER,
} from "../src/idempotency-contract.js";
import { executeProtocolPlan } from "../src/protocol-plan/runner.js";
import { deriveProtocolPlanStepIdempotencyKey } from "../src/protocol-plan/idempotency.js";
import {
  formatProtocolPlanReceiptDecodeWarning,
  formatProtocolPlanResumeHint,
  formatProtocolPlanStepFailureMessage,
  formatProtocolPlanStepLabel,
} from "../src/protocol-plan/labels.js";
import { tryDecodeProtocolPlanStepReceipt } from "../src/protocol-plan/receipt.js";
import type { ProtocolExecutionPlanLike } from "../src/protocol-plan/types.js";
import {
  buildProtocolPlanWarnings,
  collectProtocolPlanStepWarnings,
} from "../src/protocol-plan/warnings.js";
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

const ROOT_IDEMPOTENCY_KEY = "75d6e51f-4f27-4f17-b32f-4708fdb0f3be";

function buildPlan(): ProtocolExecutionPlanLike<"stake.deposit-goal"> {
  const canonicalPlan = buildGoalStakeDepositPlan({
    network: "base",
    stakeVaultAddress: "0x0000000000000000000000000000000000000022",
    goalTokenAddress: "0x0000000000000000000000000000000000000011",
    amount: "100",
    approvalMode: "force",
  });

  return {
    ...canonicalPlan,
    summary: "Deposit goal stake into the stake vault.",
    preconditions: [
      "Ensure the goal is active before depositing stake.",
    ],
    expectedEvents: ["Approval", "GoalStaked"],
  };
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

async function withRpcServer(
  responder: (method: string, params: unknown[] | undefined) => unknown | Promise<unknown>,
  run: (url: string) => Promise<void>
): Promise<void> {
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer | string) => {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk);
    });
    request.on("end", async () => {
      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        id?: string | number;
        method: string;
        params?: unknown[];
      };
      try {
        const result = await responder(payload.method, payload.params);
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: payload.id ?? 1,
            result,
          })
        );
      } catch (error) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: payload.id ?? 1,
            error: {
              code: -32000,
              message: error instanceof Error ? error.message : String(error),
            },
          })
        );
      }
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Failed to determine JSON-RPC test server address.");
  }

  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
}

function buildReceipt(txHash: Hex, topicSeed: string): Record<string, unknown> {
  const blockHash = `0x${"a".repeat(64)}`;
  return {
    blockHash,
    blockNumber: "0x1",
    transactionHash: txHash,
    transactionIndex: "0x0",
    from: "0x00000000000000000000000000000000000000aa",
    to: "0x00000000000000000000000000000000000000bb",
    cumulativeGasUsed: "0x5208",
    gasUsed: "0x5208",
    contractAddress: null,
    logsBloom: `0x${"0".repeat(512)}`,
    status: "0x1",
    effectiveGasPrice: "0x1",
    type: "0x2",
    logs: [
      {
        address: "0x00000000000000000000000000000000000000bb",
        topics: [`0x${topicSeed.repeat(64)}`],
        data: "0x",
        blockHash,
        blockNumber: "0x1",
        transactionHash: txHash,
        transactionIndex: "0x0",
        logIndex: "0x0",
        removed: false,
      },
    ],
  };
}

describe("protocol plan runner", () => {
  beforeEach(() => {
    localExecMocks.executeLocalTxMock.mockReset();
  });

  it("returns an explicit multi-step dry run contract without broadcasting", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
        agent: "ops",
      },
    });

    const result = await executeProtocolPlan({
      deps: harness.deps,
      plan: buildPlan(),
      dryRun: true,
    });

    expect(result).toMatchObject({
      ok: true,
      dryRun: true,
      idempotencyKey: "8e03978e-40d5-43e8-bc93-6894a57f9324",
      agentKey: "ops",
      walletMode: "hosted",
      action: "stake.deposit-goal",
      network: "base",
      riskClass: "stake",
      expectedEvents: ["Approval", "GoalStaked"],
      stepCount: 2,
      executedStepCount: 0,
      replayedStepCount: 0,
      execution: {
        mode: "hosted-batch",
        atomic: true,
        idempotencyKey: "8e03978e-40d5-43e8-bc93-6894a57f9324",
        request: {
          method: "POST",
          path: "/api/cli/exec",
          body: {
            kind: "protocol-plan",
            network: "base",
            action: "stake.deposit-goal",
            riskClass: "stake",
            agentKey: "ops",
          },
        },
      },
    });
    expect(result.warnings).toContain(
      "Plan declares 1 precondition(s) that the CLI does not verify automatically."
    );
    expect(result.warnings).toContain(
      "Plan includes 1 ERC-20 approval step(s); verify spender addresses and allowance amounts before execution."
    );
    expect(result.warnings).toContain("Dry run only; no transactions were broadcast.");
    expect(result.steps).toMatchObject([
      {
        stepNumber: 1,
        label: "Approve goal token for stake vault",
        displayLabel: "Step 1/2: Approve goal token for stake vault",
        kind: "erc20-approval",
        executionTarget: "hosted_api",
        status: "dry-run",
        request: {
          kind: "protocol-step",
          network: "base",
          action: "stake.deposit-goal",
          riskClass: "stake",
          agentKey: "ops",
          step: {
            kind: "erc20-approval",
            transaction: {
              to: "0x0000000000000000000000000000000000000011",
            },
          },
        },
      },
      {
        stepNumber: 2,
        label: "Deposit goal stake",
        displayLabel: "Step 2/2: Deposit goal stake",
        kind: "contract-call",
        executionTarget: "hosted_api",
        status: "dry-run",
      },
    ]);
    expect(result.steps[0]?.idempotencyKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(result.steps[0]?.idempotencyKey).toBe(result.idempotencyKey);
    expect(result.steps[1]?.idempotencyKey).toBe(result.idempotencyKey);
    expect(harness.fetchMock).not.toHaveBeenCalled();
    expect(localExecMocks.executeLocalTxMock).not.toHaveBeenCalled();
  });

  it("keeps local-wallet dry-run requests on the raw tx contract", async () => {
    const harness = createHarness({
      config: {
        agent: "pilot",
      },
    });
    setLocalWalletConfig(harness, "pilot");

    const result = await executeProtocolPlan({
      deps: harness.deps,
      plan: buildPlan(),
      agent: "pilot",
      dryRun: true,
    });

    expect(result.walletMode).toBe("local");
    expect(result.execution).toEqual({
      mode: "local-sequential",
      atomic: false,
      idempotencyKey: result.idempotencyKey,
    });
    expect(result.steps).toMatchObject([
      {
        stepNumber: 1,
        executionTarget: "local_wallet",
        request: {
          kind: "tx",
          network: "base",
          agentKey: "pilot",
          to: "0x0000000000000000000000000000000000000011",
          valueEth: "0",
        },
      },
      {
        stepNumber: 2,
        executionTarget: "local_wallet",
        request: {
          kind: "tx",
          network: "base",
          agentKey: "pilot",
          to: "0x0000000000000000000000000000000000000022",
          valueEth: "0",
        },
      },
    ]);
    expect(result.execution?.request).toBeUndefined();
    expect(result.steps[0]?.idempotencyKey).not.toBe(result.idempotencyKey);
    expect(result.steps[1]?.idempotencyKey).not.toBe(result.idempotencyKey);
    expect(harness.fetchMock).not.toHaveBeenCalled();
    expect(localExecMocks.executeLocalTxMock).not.toHaveBeenCalled();
  });

  it("supports hosted raw-tx dry runs on the shared runner", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
        agent: "ops",
      },
    });

    const result = await executeProtocolPlan({
      deps: harness.deps,
      plan: buildPlan(),
      mode: "raw-tx",
      dryRun: true,
    });

    expect(result.walletMode).toBe("hosted");
    expect(result.execution).toEqual({
      mode: "hosted-sequential",
      atomic: false,
      idempotencyKey: result.idempotencyKey,
    });
    expect(result.steps).toMatchObject([
      {
        stepNumber: 1,
        executionTarget: "hosted_api",
        request: {
          kind: "tx",
          network: "base",
          agentKey: "ops",
          to: "0x0000000000000000000000000000000000000011",
          valueEth: "0",
        },
      },
      {
        stepNumber: 2,
        executionTarget: "hosted_api",
        request: {
          kind: "tx",
          network: "base",
          agentKey: "ops",
          to: "0x0000000000000000000000000000000000000022",
          valueEth: "0",
        },
      },
    ]);
    expect(result.steps[0]?.idempotencyKey).not.toBe(result.idempotencyKey);
    expect(result.steps[1]?.idempotencyKey).not.toBe(result.idempotencyKey);
    expect(harness.fetchMock).not.toHaveBeenCalled();
  });

  it("executes hosted plan steps in order and attaches decoded receipt summaries", async () => {
    const txHashes = [
      `0x${"1".repeat(64)}`,
      `0x${"2".repeat(64)}`,
    ] as const;
    const plan = buildPlan();
    type HostedCall = {
      url: string;
      headers: Record<string, string>;
      body: Record<string, unknown>;
    };

    await withRpcServer(
      async (method, params) => {
        if (method !== "eth_getTransactionReceipt") {
          throw new Error(`Unsupported method: ${method}`);
        }
        const txHash = params?.[0];
        if (txHash === txHashes[0]) {
          return buildReceipt(txHashes[0], "1");
        }
        if (txHash === txHashes[1]) {
          return buildReceipt(txHashes[1], "2");
        }
        throw new Error(`Unexpected tx hash: ${String(txHash)}`);
      },
      async (rpcUrl) => {
        const hostedCalls: HostedCall[] = [];
        const harness = createHarness({
          config: {
            url: "https://api.example",
            token: "bbt_secret",
          },
          fetchResponder: async (input, init) => {
            const requestHeaders = (init?.headers ?? {}) as Record<string, string>;
            hostedCalls.push({
              url: input instanceof URL ? input.toString() : String(input),
              headers: requestHeaders,
              body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
            });
            return {
              ok: true,
              status: 200,
              text: async () =>
                JSON.stringify({
                  ok: true,
                  transactionHash: txHashes[1],
                  userOpHash: `0x${"f".repeat(64)}`,
                }),
            };
          },
        });
        harness.deps.env = {
          COBUILD_CLI_BASE_RPC_URL: rpcUrl,
        };

        const result = await executeProtocolPlan({
          deps: harness.deps,
          plan,
          idempotencyKey: ROOT_IDEMPOTENCY_KEY,
          getStepReceiptDecoder: ({ step, stepNumber }) => ({
            decode: ({ logs }) => ({
              stepNumber,
              kind: step.kind,
              logCount: logs.length,
            }),
          }),
        });

        expect(hostedCalls).toHaveLength(1);
        expect(hostedCalls[0]?.url).toBe("https://api.example/api/cli/exec");
        expect(hostedCalls[0]?.body).toEqual(result.execution?.request?.body);
        expect(hostedCalls[0]?.headers[IDEMPOTENCY_PRIMARY_HEADER]).toBe(ROOT_IDEMPOTENCY_KEY);
        expect(hostedCalls[0]?.headers[IDEMPOTENCY_DEPRECATED_HEADER]).toBe(ROOT_IDEMPOTENCY_KEY);
        expect(harness.fetchMock).toHaveBeenCalledTimes(1);
        expect(result).toMatchObject({
          ok: true,
          idempotencyKey: ROOT_IDEMPOTENCY_KEY,
          walletMode: "hosted",
          stepCount: 2,
          executedStepCount: 2,
          replayedStepCount: 0,
          execution: {
            mode: "hosted-batch",
            atomic: true,
            idempotencyKey: ROOT_IDEMPOTENCY_KEY,
            userOpHash: `0x${"f".repeat(64)}`,
            transactionHash: txHashes[1],
          },
          warnings: [
            "Plan declares 1 precondition(s) that the CLI does not verify automatically.",
            "Plan includes 1 ERC-20 approval step(s); verify spender addresses and allowance amounts before execution.",
          ],
        });
        expect(result.steps).toMatchObject([
          {
            stepNumber: 1,
            status: "succeeded",
            transactionHash: txHashes[1],
            receiptSummary: {
              stepNumber: 1,
              kind: "erc20-approval",
              logCount: 1,
            },
          },
          {
            stepNumber: 2,
            status: "succeeded",
            transactionHash: txHashes[1],
            receiptSummary: {
              stepNumber: 2,
              kind: "contract-call",
              logCount: 1,
            },
          },
        ]);
      }
    );
  });

  it("marks hosted batched replay at the root execution level and for every logical step", async () => {
    const transactionHash = `0x${"5".repeat(64)}` as const;
    const userOpHash = `0x${"6".repeat(64)}` as const;
    const plan = buildPlan();
    type HostedCall = {
      url: string;
      headers: Record<string, string>;
      body: Record<string, unknown>;
    };

    await withRpcServer(
      async (method, params) => {
        if (method !== "eth_getTransactionReceipt") {
          throw new Error(`Unsupported method: ${method}`);
        }
        if (params?.[0] === transactionHash) {
          return buildReceipt(transactionHash, "9");
        }
        throw new Error(`Unexpected tx hash: ${String(params?.[0])}`);
      },
      async (rpcUrl) => {
        const hostedCalls: HostedCall[] = [];
        const harness = createHarness({
          config: {
            url: "https://api.example",
            token: "bbt_secret",
          },
          fetchResponder: async (input, init) => {
            const requestHeaders = (init?.headers ?? {}) as Record<string, string>;
            hostedCalls.push({
              url: input instanceof URL ? input.toString() : String(input),
              headers: requestHeaders,
              body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
            });
            return {
              ok: true,
              status: 200,
              text: async () =>
                JSON.stringify({
                  ok: true,
                  replayed: true,
                  transactionHash,
                  explorerUrl: `https://basescan.org/tx/${transactionHash}`,
                  userOpHash,
                }),
            };
          },
        });
        harness.deps.env = {
          COBUILD_CLI_BASE_RPC_URL: rpcUrl,
        };

        const result = await executeProtocolPlan({
          deps: harness.deps,
          plan,
          idempotencyKey: ROOT_IDEMPOTENCY_KEY,
          getStepReceiptDecoder: ({ step, stepNumber }) => ({
            decode: ({ logs }) => ({
              stepNumber,
              kind: step.kind,
              logCount: logs.length,
            }),
          }),
        });

        expect(hostedCalls).toHaveLength(1);
        expect(hostedCalls[0]?.url).toBe("https://api.example/api/cli/exec");
        expect(hostedCalls[0]?.body).toEqual(result.execution?.request?.body);
        expect(hostedCalls[0]?.headers[IDEMPOTENCY_PRIMARY_HEADER]).toBe(ROOT_IDEMPOTENCY_KEY);
        expect(hostedCalls[0]?.headers[IDEMPOTENCY_DEPRECATED_HEADER]).toBe(ROOT_IDEMPOTENCY_KEY);
        expect(result.execution).toMatchObject({
          mode: "hosted-batch",
          atomic: true,
          idempotencyKey: ROOT_IDEMPOTENCY_KEY,
          replayed: true,
          userOpHash,
          transactionHash,
          explorerUrl: `https://basescan.org/tx/${transactionHash}`,
        });
        expect(result.replayedStepCount).toBe(result.stepCount);
        expect(result.steps.every((step) => step.idempotencyKey === ROOT_IDEMPOTENCY_KEY)).toBe(true);
        expect(result.steps.every((step) => step.replayed === true)).toBe(true);
      }
    );
  });

  it("routes protocol plans through the local wallet path when configured", async () => {
    const harness = createHarness({
      config: {
        agent: "pilot",
      },
    });
    setLocalWalletConfig(harness, "pilot");
    localExecMocks.executeLocalTxMock
      .mockResolvedValueOnce({
        ok: true,
        kind: "tx",
        transactionHash: `0x${"a".repeat(64)}`,
        explorerUrl: "https://basescan.org/tx/0xaaa",
      })
      .mockResolvedValueOnce({
        ok: true,
        kind: "tx",
        transactionHash: `0x${"b".repeat(64)}`,
        explorerUrl: "https://basescan.org/tx/0xbbb",
      });

    const result = await executeProtocolPlan({
      deps: harness.deps,
      plan: buildPlan(),
      agent: "pilot",
      idempotencyKey: ROOT_IDEMPOTENCY_KEY,
    });

    expect(harness.fetchMock).not.toHaveBeenCalled();
    expect(localExecMocks.executeLocalTxMock).toHaveBeenCalledTimes(2);
    expect(localExecMocks.executeLocalTxMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        agentKey: "pilot",
        network: "base",
        to: buildPlan().steps[0]?.transaction.to,
        data: buildPlan().steps[0]?.transaction.data,
        idempotencyKey: result.steps[0]?.idempotencyKey,
      })
    );
    expect(localExecMocks.executeLocalTxMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        agentKey: "pilot",
        network: "base",
        to: buildPlan().steps[1]?.transaction.to,
        data: buildPlan().steps[1]?.transaction.data,
        idempotencyKey: result.steps[1]?.idempotencyKey,
      })
    );
    expect(result).toMatchObject({
      ok: true,
      walletMode: "local",
      replayedStepCount: 0,
      execution: {
        mode: "local-sequential",
        atomic: false,
        idempotencyKey: ROOT_IDEMPOTENCY_KEY,
      },
    });
    expect(result.execution?.request).toBeUndefined();
    expect(result.steps[0]?.idempotencyKey).not.toBe(ROOT_IDEMPOTENCY_KEY);
    expect(result.steps[1]?.idempotencyKey).not.toBe(ROOT_IDEMPOTENCY_KEY);
  });

  it("keeps deterministic child idempotency keys for local reruns so completed steps replay safely", async () => {
    const plan = buildPlan();
    const firstStepKey = deriveProtocolPlanStepIdempotencyKey({
      rootIdempotencyKey: ROOT_IDEMPOTENCY_KEY,
      plan,
      step: plan.steps[0]!,
      stepNumber: 1,
    });
    const secondStepKey = deriveProtocolPlanStepIdempotencyKey({
      rootIdempotencyKey: ROOT_IDEMPOTENCY_KEY,
      plan,
      step: plan.steps[1]!,
      stepNumber: 2,
    });
    const attemptCounts = new Map<string, number>();
    const txHashes = {
      first: `0x${"3".repeat(64)}`,
      second: `0x${"4".repeat(64)}`,
    };
    const harness = createHarness({
      config: {
        agent: "pilot",
      },
    });
    setLocalWalletConfig(harness, "pilot");
    localExecMocks.executeLocalTxMock.mockImplementation(async (params: { idempotencyKey: string }) => {
        const key = params.idempotencyKey;
        const nextCount = (attemptCounts.get(key) ?? 0) + 1;
        attemptCounts.set(key, nextCount);

        if (key === firstStepKey) {
          return {
            ok: true,
            kind: "tx",
            transactionHash: txHashes.first,
            ...(nextCount > 1 ? { replayed: true } : {}),
          } as const;
        }

        if (key === secondStepKey && nextCount === 1) {
          throw new Error("Request failed (status 500): boom");
        }

        if (key === secondStepKey) {
          return {
            ok: true,
            kind: "tx",
            transactionHash: txHashes.second,
          } as const;
        }

        throw new Error(`Unexpected idempotency key: ${key}`);
    });

    await expect(
      executeProtocolPlan({
        deps: harness.deps,
        plan,
        agent: "pilot",
        idempotencyKey: ROOT_IDEMPOTENCY_KEY,
      })
    ).rejects.toThrow(
      `Step 2/2: Deposit goal stake failed: Request failed (status 500): boom (step idempotency key: ${secondStepKey}, root idempotency key: ${ROOT_IDEMPOTENCY_KEY}). Re-run the same command with --idempotency-key ${ROOT_IDEMPOTENCY_KEY} to resume safely.`
    );

    const resumed = await executeProtocolPlan({
      deps: harness.deps,
      plan,
      agent: "pilot",
      idempotencyKey: ROOT_IDEMPOTENCY_KEY,
    });

    expect(attemptCounts.get(firstStepKey)).toBe(2);
    expect(attemptCounts.get(secondStepKey)).toBe(2);
    expect(resumed.replayedStepCount).toBe(1);
    expect(resumed.steps[0]).toMatchObject({
      idempotencyKey: firstStepKey,
      replayed: true,
      transactionHash: txHashes.first,
    });
    expect(resumed.steps[1]).toMatchObject({
      idempotencyKey: secondStepKey,
      transactionHash: txHashes.second,
    });
    expect(harness.fetchMock).not.toHaveBeenCalled();
  });

  it("canonicalizes supported network aliases when deriving child idempotency keys", () => {
    const plan = buildPlan();
    const baseKey = deriveProtocolPlanStepIdempotencyKey({
      rootIdempotencyKey: ROOT_IDEMPOTENCY_KEY,
      plan,
      step: plan.steps[0]!,
      stepNumber: 1,
    });
    const aliasKey = deriveProtocolPlanStepIdempotencyKey({
      rootIdempotencyKey: ROOT_IDEMPOTENCY_KEY,
      plan: {
        ...plan,
        network: "base-mainnet",
      },
      step: plan.steps[0]!,
      stepNumber: 1,
    });

    expect(aliasKey).toBe(baseKey);
  });

  it("rejects unsupported protocol plan networks before any step runs", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
    });
    const plan = {
      ...buildPlan(),
      network: "optimism",
    };

    await expect(
      executeProtocolPlan({
        deps: harness.deps,
        plan,
      })
    ).rejects.toThrow('Unsupported network "optimism". Only "base" is supported.');
    expect(harness.fetchMock).not.toHaveBeenCalled();
    expect(localExecMocks.executeLocalTxMock).not.toHaveBeenCalled();
  });

  it("promotes step receipt decode failures into step and aggregate warnings", async () => {
    const harness = createHarness({
      config: {
        agent: "pilot",
      },
    });
    setLocalWalletConfig(harness, "pilot");
    localExecMocks.executeLocalTxMock.mockResolvedValue({
      ok: true,
      kind: "tx",
      transactionHash: "0x1234",
    });

    const result = await executeProtocolPlan({
      deps: harness.deps,
      plan: {
        ...buildPlan(),
        steps: [buildPlan().steps[0]!],
      },
      agent: "pilot",
      getStepReceiptDecoder: () => ({
        decode: () => ({ ok: true }),
      }),
    });

    expect(result.steps[0]).toMatchObject({
      receiptDecodeError: 'Skipping receipt decode: invalid transaction hash "0x1234".',
      warnings: ['Skipping receipt decode: invalid transaction hash "0x1234".'],
    });
    expect(result.warnings).toContain(
      'Step 1/1: Approve goal token for stake vault receipt decode warning: Skipping receipt decode: invalid transaction hash "0x1234".'
    );
  });

  it("covers shared protocol plan label and warning helpers", () => {
    expect(
      formatProtocolPlanStepLabel({
        stepNumber: 2,
        stepCount: 3,
        label: "Claim premium",
      })
    ).toBe("Step 2/3: Claim premium");
    expect(formatProtocolPlanResumeHint(ROOT_IDEMPOTENCY_KEY)).toBe(
      `Re-run the same command with --idempotency-key ${ROOT_IDEMPOTENCY_KEY} to resume safely.`
    );
    expect(
      formatProtocolPlanStepFailureMessage({
        displayLabel: "Step 2/3: Claim premium",
        stepIdempotencyKey: "11111111-1111-4111-8111-111111111111",
        rootIdempotencyKey: ROOT_IDEMPOTENCY_KEY,
        cause: "boom",
      })
    ).toContain("Step 2/3: Claim premium failed: boom");
    expect(
      formatProtocolPlanReceiptDecodeWarning({
        displayLabel: "Step 1/1: Claim premium",
        error: "invalid receipt",
      })
    ).toBe("Step 1/1: Claim premium receipt decode warning: invalid receipt");

    expect(
      buildProtocolPlanWarnings({
        network: "base",
        action: "premium.claim",
        riskClass: "claim",
        summary: "Claim premium",
        preconditions: [],
        steps: [
          {
            kind: "contract-call",
            label: "Claim premium",
            contract: "PremiumEscrow",
            functionName: "claim",
            transaction: {
              to: "0x00000000000000000000000000000000000000aa",
              data: "0x1234",
              valueEth: "0",
            },
          },
        ],
      })
    ).toEqual([]);

    expect(
      collectProtocolPlanStepWarnings([
        {
          stepNumber: 1,
          label: "Claim premium",
          displayLabel: "Step 1/1: Claim premium",
          kind: "contract-call",
          idempotencyKey: ROOT_IDEMPOTENCY_KEY,
          executionTarget: "hosted_api",
          transaction: {
            to: "0x00000000000000000000000000000000000000aa",
            data: "0x1234",
            valueEth: "0",
          },
          request: {
            kind: "tx",
            network: "base",
            agentKey: "default",
            to: "0x00000000000000000000000000000000000000aa",
            data: "0x1234",
            valueEth: "0",
          },
          status: "succeeded",
          warnings: [],
          receiptDecodeError: "invalid receipt",
        },
      ])
    ).toEqual(["Step 1/1: Claim premium receipt decode warning: invalid receipt"]);
  });

  it("returns protocol receipt decode warnings for unsupported networks, invalid hashes, and lookup failures", async () => {
    const plan = buildPlan();
    const decoder = {
      decode: () => ({ ok: true }),
    };

    await expect(
      tryDecodeProtocolPlanStepReceipt({
        deps: {},
        network: "optimism",
        transactionHash: `0x${"1".repeat(64)}`,
        plan,
        step: plan.steps[0]!,
        stepNumber: 1,
        decoder,
      })
    ).resolves.toEqual({
      receiptDecodeError: 'Skipping receipt decode for unsupported network "optimism".',
    });

    await expect(
      tryDecodeProtocolPlanStepReceipt({
        deps: {},
        network: "base",
        transactionHash: "0x1234",
        plan,
        step: plan.steps[0]!,
        stepNumber: 1,
        decoder,
      })
    ).resolves.toEqual({
      receiptDecodeError: 'Skipping receipt decode: invalid transaction hash "0x1234".',
    });

    const failedLookup = await tryDecodeProtocolPlanStepReceipt({
      deps: {
        env: {
          COBUILD_CLI_BASE_RPC_URL: "http://127.0.0.1:1",
        },
      },
      network: "base",
      transactionHash: `0x${"2".repeat(64)}`,
      plan,
      step: plan.steps[0]!,
      stepNumber: 1,
      decoder,
    });
    expect(failedLookup.receiptDecodeError).toContain("Receipt decode failed:");
  });

  it("serializes receipt summaries when decoders return scalars or custom serializers", async () => {
    const txHash = `0x${"5".repeat(64)}` as Hex;
    const plan = buildPlan();

    await withRpcServer(
      async (method) => {
        if (method !== "eth_getTransactionReceipt") {
          throw new Error(`Unsupported method: ${method}`);
        }
        return buildReceipt(txHash, "5");
      },
      async (rpcUrl) => {
        const scalarSummary = await tryDecodeProtocolPlanStepReceipt({
          deps: {
            env: {
              COBUILD_CLI_BASE_RPC_URL: rpcUrl,
            },
          },
          network: "base",
          transactionHash: txHash,
          plan,
          step: plan.steps[0]!,
          stepNumber: 1,
          decoder: {
            decode: () => 7n,
          },
        });
        expect(scalarSummary).toEqual({
          receiptSummary: {
            summary: "7",
          },
        });

        const customSummary = await tryDecodeProtocolPlanStepReceipt({
          deps: {
            env: {
              COBUILD_CLI_BASE_RPC_URL: rpcUrl,
            },
          },
          network: "base",
          transactionHash: txHash,
          plan,
          step: plan.steps[1]!,
          stepNumber: 2,
          decoder: {
            decode: () => ({ count: 1n }),
            serialize: (summary: { count: bigint }) => ({
              count: String(summary.count),
              source: "custom",
            }),
          },
        });
        expect(customSummary).toEqual({
          receiptSummary: {
            count: "1",
            source: "custom",
          },
        });
      }
    );
  });
});
