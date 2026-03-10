import { createServer } from "node:http";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics, type Hex } from "viem";
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

vi.mock("@cobuild/wire", async () => {
  const actual = await vi.importActual<typeof import("@cobuild/wire")>("@cobuild/wire");
  const goalFactoryAbi = [
    {
      type: "event",
      name: "GoalDeployed",
      anonymous: false,
      inputs: [
        { indexed: true, name: "goal", type: "address" },
        { indexed: false, name: "checkpoints", type: "uint256[]" },
      ],
    },
    {
      type: "function",
      name: "deployGoal",
      stateMutability: "nonpayable",
      inputs: [
        {
          name: "p",
          type: "tuple",
          components: [
            {
              name: "revnet",
              type: "tuple",
              components: [
                { name: "owner", type: "address" },
                { name: "name", type: "string" },
                { name: "ticker", type: "string" },
                { name: "uri", type: "string" },
                { name: "initialIssuance", type: "uint112" },
                { name: "cashOutTaxRate", type: "uint16" },
                { name: "reservedPercent", type: "uint16" },
                { name: "durationSeconds", type: "uint32" },
              ],
            },
            {
              name: "timing",
              type: "tuple",
              components: [
                { name: "minRaise", type: "uint256" },
                { name: "minRaiseDurationSeconds", type: "uint32" },
              ],
            },
            {
              name: "success",
              type: "tuple",
              components: [
                { name: "successResolver", type: "address" },
                { name: "successAssertionLiveness", type: "uint64" },
                { name: "successAssertionBond", type: "uint256" },
                { name: "successOracleSpecHash", type: "bytes32" },
                { name: "successAssertionPolicyHash", type: "bytes32" },
              ],
            },
            {
              name: "flowMetadata",
              type: "tuple",
              components: [
                { name: "title", type: "string" },
                { name: "description", type: "string" },
                { name: "image", type: "string" },
                { name: "tagline", type: "string" },
                { name: "url", type: "string" },
              ],
            },
            {
              name: "underwriting",
              type: "tuple",
              components: [
                { name: "coverageLambda", type: "uint256" },
                { name: "budgetPremiumPpm", type: "uint32" },
                { name: "budgetSlashPpm", type: "uint32" },
              ],
            },
            {
              name: "budgetTCR",
              type: "tuple",
              components: [
                { name: "allocationMechanismAdmin", type: "address" },
                { name: "invalidRoundRewardsSink", type: "address" },
                { name: "submissionDepositStrategy", type: "address" },
                { name: "submissionBaseDeposit", type: "uint256" },
                { name: "removalBaseDeposit", type: "uint256" },
                { name: "submissionChallengeBaseDeposit", type: "uint256" },
                { name: "removalChallengeBaseDeposit", type: "uint256" },
                { name: "registrationMetaEvidence", type: "string" },
                { name: "clearingMetaEvidence", type: "string" },
                { name: "challengePeriodDuration", type: "uint256" },
                { name: "arbitratorExtraData", type: "bytes" },
                {
                  name: "budgetBounds",
                  type: "tuple",
                  components: [
                    { name: "minFundingLeadTime", type: "uint64" },
                    { name: "maxFundingHorizon", type: "uint64" },
                    { name: "minExecutionDuration", type: "uint64" },
                    { name: "maxExecutionDuration", type: "uint64" },
                    { name: "minActivationThreshold", type: "uint256" },
                    { name: "maxActivationThreshold", type: "uint256" },
                    { name: "maxRunwayCap", type: "uint256" },
                  ],
                },
                {
                  name: "oracleBounds",
                  type: "tuple",
                  components: [
                    { name: "liveness", type: "uint64" },
                    { name: "bondAmount", type: "uint256" },
                  ],
                },
                { name: "budgetSuccessResolver", type: "address" },
                {
                  name: "arbitratorParams",
                  type: "tuple",
                  components: [
                    { name: "votingPeriod", type: "uint256" },
                    { name: "votingDelay", type: "uint256" },
                    { name: "revealPeriod", type: "uint256" },
                    { name: "arbitrationCost", type: "uint256" },
                    { name: "wrongOrMissedSlashBps", type: "uint256" },
                    { name: "slashCallerBountyBps", type: "uint256" },
                  ],
                },
              ],
            },
          ],
        },
      ],
      outputs: [],
    },
  ];
  return {
    ...actual,
    goalFactoryAbi,
  };
});

import { executeGoalCreateCommand } from "../src/commands/goal.js";

const EXPLICIT_UUID = "75d6e51f-4f27-4f17-b32f-4708fdb0f3be";
const GOAL_FACTORY = "0x000000000000000000000000000000000000dEaD";
const GOAL_DEPLOYED_EVENT = {
  type: "event",
  name: "GoalDeployed",
  anonymous: false,
  inputs: [
    { indexed: true, name: "goal", type: "address" },
    { indexed: false, name: "checkpoints", type: "uint256[]" },
  ],
} as const;

function buildDeployParams(): Record<string, unknown> {
  return {
    revnet: {
      owner: "0x00000000000000000000000000000000000000aa",
      name: "Goal",
      ticker: "GOAL",
      uri: "ipfs://goal",
      initialIssuance: "1000000000000000000",
      cashOutTaxRate: "0",
      reservedPercent: "9900",
      durationSeconds: "86400",
    },
    timing: {
      minRaise: "100000000000000000000",
      minRaiseDurationSeconds: "43200",
    },
    success: {
      successResolver: "0x00000000000000000000000000000000000000bb",
      successAssertionLiveness: "7200",
      successAssertionBond: "0",
      successOracleSpecHash: `0x${"11".repeat(32)}`,
      successAssertionPolicyHash: `0x${"22".repeat(32)}`,
    },
    flowMetadata: {
      title: "Goal",
      description: "Goal flow",
      image: "ipfs://image",
      tagline: "tagline",
      url: "https://example.com",
    },
    underwriting: {
      coverageLambda: "0",
      budgetPremiumPpm: "0",
      budgetSlashPpm: "0",
    },
    budgetTCR: {
      allocationMechanismAdmin: "0x00000000000000000000000000000000000000aa",
      invalidRoundRewardsSink: "0x000000000000000000000000000000000000dEaD",
      submissionDepositStrategy: "0x0000000000000000000000000000000000000000",
      submissionBaseDeposit: "0",
      removalBaseDeposit: "0",
      submissionChallengeBaseDeposit: "0",
      removalChallengeBaseDeposit: "0",
      registrationMetaEvidence: "ipfs://reg",
      clearingMetaEvidence: "ipfs://clear",
      challengePeriodDuration: "3600",
      arbitratorExtraData: "0x",
      budgetBounds: {
        minFundingLeadTime: "0",
        maxFundingHorizon: "86400",
        minExecutionDuration: "0",
        maxExecutionDuration: "86400",
        minActivationThreshold: "0",
        maxActivationThreshold: "1000000000000000000",
        maxRunwayCap: "1000000000000000000",
      },
      oracleBounds: {
        liveness: "1",
        bondAmount: "1",
      },
      budgetSuccessResolver: "0x00000000000000000000000000000000000000bb",
      arbitratorParams: {
        votingPeriod: "3600",
        votingDelay: "1",
        revealPeriod: "1",
        arbitrationCost: "1000000000000000",
        wrongOrMissedSlashBps: "50",
        slashCallerBountyBps: "100",
      },
    },
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
      const body = Buffer.concat(chunks).toString("utf8");
      const payload = JSON.parse(body) as {
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
    throw new Error("Failed to determine JSON-RPC test server address");
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

function buildReceipt(params: {
  txHash: Hex;
  logs: Array<{
    address: string;
    topics: Hex[];
    data: Hex;
  }>;
}): Record<string, unknown> {
  const blockHash = `0x${"a".repeat(64)}`;
  return {
    blockHash,
    blockNumber: "0x1",
    transactionHash: params.txHash,
    transactionIndex: "0x0",
    from: "0x00000000000000000000000000000000000000aa",
    to: GOAL_FACTORY.toLowerCase(),
    cumulativeGasUsed: "0x5208",
    gasUsed: "0x5208",
    contractAddress: null,
    logsBloom: `0x${"0".repeat(512)}`,
    status: "0x1",
    effectiveGasPrice: "0x1",
    type: "0x2",
    logs: params.logs.map((log, index) => ({
      ...log,
      blockHash,
      blockNumber: "0x1",
      transactionHash: params.txHash,
      transactionIndex: "0x0",
      logIndex: `0x${index.toString(16)}`,
      removed: false,
    })),
  };
}

describe("goal create command", () => {
  beforeEach(() => {
    localExecMocks.executeLocalTxMock.mockReset();
  });

  it("routes hosted goal creation through /api/cli/exec tx envelope", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
      fetchResponder: async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true }),
      }),
    });

    await runCli(
      [
        "goal",
        "create",
        "--factory",
        GOAL_FACTORY,
        "--params-json",
        JSON.stringify(buildDeployParams()),
        "--idempotency-key",
        EXPLICIT_UUID,
      ],
      harness.deps
    );

    const [input, init] = harness.fetchMock.mock.calls[0];
    expect(String(input)).toBe("https://api.example/api/cli/exec");
    expect(init?.headers).toMatchObject({
      "X-Idempotency-Key": EXPLICIT_UUID,
      "Idempotency-Key": EXPLICIT_UUID,
      authorization: "Bearer bbt_secret",
    });

    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      kind: "tx",
      network: "base",
      agentKey: "default",
      to: GOAL_FACTORY.toLowerCase(),
      valueEth: "0",
    });
    expect(body.data).toMatch(/^0x9cdeea05/i);

    const output = JSON.parse(harness.outputs.at(-1) ?? "{}");
    expect(output).toMatchObject({
      ok: true,
      idempotencyKey: EXPLICIT_UUID,
      goalFactory: GOAL_FACTORY.toLowerCase(),
      network: "base",
    });
  });

  it("routes goal creation through local tx execution when wallet mode is local", async () => {
    const harness = createHarness({
      config: {
        agent: "default",
      },
    });
    setLocalWalletConfig(harness);
    localExecMocks.executeLocalTxMock.mockResolvedValue({
      ok: true,
      kind: "tx",
    });

    const result = await executeGoalCreateCommand(
      {
        factory: GOAL_FACTORY,
        paramsJson: JSON.stringify({
          deployParams: buildDeployParams(),
        }),
      },
      harness.deps
    );

    expect(localExecMocks.executeLocalTxMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agentKey: "default",
        network: "base",
        to: GOAL_FACTORY.toLowerCase(),
        valueEth: "0",
      })
    );
    const localInput = localExecMocks.executeLocalTxMock.mock.calls[0]?.[0] as {
      data: string;
    };
    expect(localInput.data).toMatch(/^0x9cdeea05/i);
    expect(harness.fetchMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: true,
      kind: "tx",
      goalFactory: GOAL_FACTORY.toLowerCase(),
      network: "base",
    });
  });

  it("supports side-effect-free goal create dry-run output", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
        agent: "ops",
      },
    });

    await runCli(
      [
        "goal",
        "create",
        "--factory",
        GOAL_FACTORY,
        "--params-json",
        JSON.stringify(buildDeployParams()),
        "--dry-run",
      ],
      harness.deps
    );

    expect(harness.fetchMock).not.toHaveBeenCalled();
    expect(localExecMocks.executeLocalTxMock).not.toHaveBeenCalled();
    expect(JSON.parse(harness.outputs.at(-1) ?? "{}")).toMatchObject({
      ok: true,
      dryRun: true,
      idempotencyKey: "8e03978e-40d5-43e8-bc93-6894a57f9324",
      goalFactory: GOAL_FACTORY.toLowerCase(),
      network: "base",
      request: {
        method: "POST",
        path: "/api/cli/exec",
        body: {
          kind: "tx",
          network: "base",
          agentKey: "ops",
          to: GOAL_FACTORY.toLowerCase(),
          valueEth: "0",
        },
      },
    });
  });

  it("rejects multiple deploy params sources", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
    });

    await expect(
      executeGoalCreateCommand(
        {
          factory: GOAL_FACTORY,
          paramsFile: "./goal.json",
          paramsJson: JSON.stringify(buildDeployParams()),
        },
        harness.deps
      )
    ).rejects.toThrow("Provide only one of --params-file, --params-json, or --params-stdin.");
  });

  it("rejects missing factory", async () => {
    const harness = createHarness();

    await expect(
      executeGoalCreateCommand(
        {
          paramsJson: JSON.stringify(buildDeployParams()),
        },
        harness.deps
      )
    ).rejects.toThrow("Usage: cli goal create --factory");
  });

  it("rejects missing goal params", async () => {
    const harness = createHarness();

    await expect(
      executeGoalCreateCommand(
        {
          factory: GOAL_FACTORY,
        },
        harness.deps
      )
    ).rejects.toThrow("Goal deploy params are required.");
  });

  it("reads deploy params from --params-file", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
      fetchResponder: async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true }),
      }),
    });
    harness.files.set("/tmp/cli-tests/goal.json", JSON.stringify(buildDeployParams()));

    const result = await executeGoalCreateCommand(
      {
        factory: GOAL_FACTORY,
        paramsFile: "/tmp/cli-tests/goal.json",
      },
      harness.deps
    );

    expect(result).toMatchObject({
      ok: true,
      goalFactory: GOAL_FACTORY.toLowerCase(),
    });
  });

  it("reads deploy params from --params-stdin", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
      fetchResponder: async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true }),
      }),
    });
    harness.deps.readStdin = async () => JSON.stringify(buildDeployParams());

    const result = await executeGoalCreateCommand(
      {
        factory: GOAL_FACTORY,
        paramsStdin: true,
      },
      harness.deps
    );

    expect(result).toMatchObject({
      ok: true,
      goalFactory: GOAL_FACTORY.toLowerCase(),
    });
  });

  it("reads deploy params from nested params key", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
      fetchResponder: async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true }),
      }),
    });

    const result = await executeGoalCreateCommand(
      {
        factory: GOAL_FACTORY,
        paramsJson: JSON.stringify({ params: buildDeployParams() }),
      },
      harness.deps
    );

    expect(result).toMatchObject({
      ok: true,
      goalFactory: GOAL_FACTORY.toLowerCase(),
    });
  });

  it("reads deploy params from nested p key", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
      fetchResponder: async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true }),
      }),
    });

    const result = await executeGoalCreateCommand(
      {
        factory: GOAL_FACTORY,
        paramsJson: JSON.stringify({ p: buildDeployParams() }),
      },
      harness.deps
    );

    expect(result).toMatchObject({
      ok: true,
      goalFactory: GOAL_FACTORY.toLowerCase(),
    });
  });

  it("rejects missing params file", async () => {
    const harness = createHarness();

    await expect(
      executeGoalCreateCommand(
        {
          factory: GOAL_FACTORY,
          paramsFile: "/tmp/cli-tests/missing-goal.json",
        },
        harness.deps
      )
    ).rejects.toThrow("Could not read --params-file /tmp/cli-tests/missing-goal.json");
  });

  it("rejects invalid params JSON", async () => {
    const harness = createHarness();

    await expect(
      executeGoalCreateCommand(
        {
          factory: GOAL_FACTORY,
          paramsJson: "{",
        },
        harness.deps
      )
    ).rejects.toThrow("Goal deploy params must be valid JSON");
  });

  it("rejects non-object params JSON", async () => {
    const harness = createHarness();

    await expect(
      executeGoalCreateCommand(
        {
          factory: GOAL_FACTORY,
          paramsJson: JSON.stringify(["not", "object"]),
        },
        harness.deps
      )
    ).rejects.toThrow("Goal deploy params must decode to a JSON object.");
  });

  it("rejects params that do not match deploy shape", async () => {
    const harness = createHarness();

    await expect(
      executeGoalCreateCommand(
        {
          factory: GOAL_FACTORY,
          paramsJson: JSON.stringify({ hello: "world" }),
        },
        harness.deps
      )
    ).rejects.toThrow(
      "Goal deploy params must include keys: revnet, timing, success, flowMetadata, underwriting, budgetTCR."
    );
  });

  it("rejects invalid generated idempotency keys before dispatch", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
    });
    harness.deps.randomUUID = () => "not-a-uuid";

    await expect(
      executeGoalCreateCommand(
        {
          factory: GOAL_FACTORY,
          paramsJson: JSON.stringify(buildDeployParams()),
        },
        harness.deps
      )
    ).rejects.toThrow("Idempotency key must be a UUID v4");
    expect(harness.fetchMock).not.toHaveBeenCalled();
    expect(localExecMocks.executeLocalTxMock).not.toHaveBeenCalled();
  });

  it("rejects invalid deploy param values for ABI encoding", async () => {
    const harness = createHarness();
    const invalid = buildDeployParams();
    (invalid.success as Record<string, unknown>).successOracleSpecHash = "0x1234";

    await expect(
      executeGoalCreateCommand(
        {
          factory: GOAL_FACTORY,
          paramsJson: JSON.stringify(invalid),
        },
        harness.deps
      )
    ).rejects.toThrow("Goal deploy params are invalid for GoalFactory.deployGoal");
  });

  it("includes idempotency context when hosted execution fails", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
      fetchResponder: async () => ({
        ok: false,
        status: 500,
        text: async () => JSON.stringify({ error: "boom" }),
      }),
    });

    await expect(
      executeGoalCreateCommand(
        {
          factory: GOAL_FACTORY,
          paramsJson: JSON.stringify(buildDeployParams()),
          idempotencyKey: EXPLICIT_UUID,
        },
        harness.deps
      )
    ).rejects.toThrow(`idempotency key: ${EXPLICIT_UUID}`);
  });

  it("includes idempotency context when local execution fails", async () => {
    const harness = createHarness({
      config: {
        agent: "default",
      },
    });
    setLocalWalletConfig(harness);
    localExecMocks.executeLocalTxMock.mockRejectedValue(new Error("local tx failed"));

    await expect(
      executeGoalCreateCommand(
        {
          factory: GOAL_FACTORY,
          paramsJson: JSON.stringify(buildDeployParams()),
          idempotencyKey: EXPLICIT_UUID,
        },
        harness.deps
      )
    ).rejects.toThrow(`local tx failed (idempotency key: ${EXPLICIT_UUID})`);
  });

  it("rejects unsupported networks before dispatch", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
      fetchResponder: async () => ({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({ ok: true, transactionHash: `0x${"1".repeat(64)}` }),
      }),
    });

    await expect(
      executeGoalCreateCommand(
        {
          factory: GOAL_FACTORY,
          paramsJson: JSON.stringify(buildDeployParams()),
          network: "optimism",
        },
        harness.deps
      )
    ).rejects.toThrow('Unsupported network "optimism". Only "base" is supported.');
    expect(harness.fetchMock).not.toHaveBeenCalled();
  });

  it("returns decode warning for invalid tx hash", async () => {
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

    const result = await executeGoalCreateCommand(
      {
        factory: GOAL_FACTORY,
        paramsJson: JSON.stringify(buildDeployParams()),
      },
      harness.deps
    );

    expect(result.goalDeploymentDecodeError).toContain("invalid transaction hash");
  });

  it("returns decode warning when receipt lookup fails", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
      fetchResponder: async () => ({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({ ok: true, transactionHash: `0x${"2".repeat(64)}` }),
      }),
    });
    harness.deps.env = {
      COBUILD_CLI_BASE_RPC_URL: "http://127.0.0.1:1",
    };

    const result = await executeGoalCreateCommand(
      {
        factory: GOAL_FACTORY,
        paramsJson: JSON.stringify(buildDeployParams()),
        network: "base",
      },
      harness.deps
    );

    expect(result.goalDeploymentDecodeError).toContain("GoalDeployed decode failed");
  });

  it("decodes GoalDeployed event args via real viem JSON-RPC client", async () => {
    const txHash = `0x${"3".repeat(64)}` as Hex;
    const goalAddress = "0x00000000000000000000000000000000000000bb";
    const topicValues = encodeEventTopics({
      abi: [GOAL_DEPLOYED_EVENT],
      eventName: "GoalDeployed",
      args: {
        goal: goalAddress,
      },
    });
    const topics = topicValues.map((topic) => {
      if (typeof topic !== "string") {
        throw new Error("Expected flat topic list for GoalDeployed test event");
      }
      return topic;
    });
    const data = encodeAbiParameters(
      [{ name: "checkpoints", type: "uint256[]" }],
      [[1n, 2n, 3n]]
    );

    await withRpcServer(
      async (method) => {
        if (method === "eth_getTransactionReceipt") {
          return buildReceipt({
            txHash,
            logs: [
              {
                address: GOAL_FACTORY.toLowerCase(),
                topics,
                data,
              },
            ],
          });
        }
        throw new Error(`Unsupported method: ${method}`);
      },
      async (rpcUrl) => {
        const harness = createHarness({
          config: {
            url: "https://api.example",
            token: "bbt_secret",
          },
          fetchResponder: async () => ({
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ ok: true, transactionHash: txHash }),
          }),
        });
        harness.deps.env = {
          COBUILD_CLI_BASE_RPC_URL: rpcUrl,
        };

        const result = await executeGoalCreateCommand(
          {
            factory: GOAL_FACTORY,
            paramsJson: JSON.stringify(buildDeployParams()),
            network: "base",
          },
          harness.deps
        );

        expect(result.goalDeployment).toEqual({
          goal: goalAddress.toLowerCase(),
          checkpoints: ["1", "2", "3"],
        });
        expect(result.goalDeploymentDecodeError).toBeUndefined();
      }
    );
  });

  it("leaves goalDeployment fields unset when receipt has no GoalDeployed events", async () => {
    const txHash = `0x${"4".repeat(64)}` as Hex;

    await withRpcServer(
      async (method) => {
        if (method === "eth_getTransactionReceipt") {
          return buildReceipt({
            txHash,
            logs: [],
          });
        }
        throw new Error(`Unsupported method: ${method}`);
      },
      async (rpcUrl) => {
        const harness = createHarness({
          config: {
            url: "https://api.example",
            token: "bbt_secret",
          },
          fetchResponder: async () => ({
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ ok: true, transactionHash: txHash }),
          }),
        });
        harness.deps.env = {
          COBUILD_CLI_BASE_RPC_URL: rpcUrl,
        };

        const result = await executeGoalCreateCommand(
          {
            factory: GOAL_FACTORY,
            paramsJson: JSON.stringify(buildDeployParams()),
            network: "base",
          },
          harness.deps
        );

        expect(result.goalDeployment).toBeUndefined();
        expect(result.goalDeploymentDecodeError).toBeUndefined();
      }
    );
  });
});
