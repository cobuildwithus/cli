import { base } from "viem/chains";
import {
  createPublicClient,
  http,
  isHex,
  type Hex,
} from "viem";
import {
  buildCliProtocolStepRequest,
  buildGoalCreateProtocolPlan,
  decodeGoalDeployedEvent,
  extractGoalFactoryDeployParams,
  serializeGoalDeployedEvent,
} from "@cobuild/wire";
import { readConfig } from "../config.js";
import { asRecord, apiPost } from "../transport.js";
import type { CliDeps } from "../types.js";
import { normalizeKeyedRemoteToolResponse } from "./remote-tool.js";
import {
  buildIdempotencyHeaders,
  normalizeEvmAddress,
  readJsonInputObject,
  resolveAgentKey,
  resolveExecIdempotencyKey,
  resolveNetwork,
  throwWithIdempotencyKey,
  withIdempotencyKey,
} from "./shared.js";
import { executeCanonicalToolOnly } from "./tool-execution.js";
import { executeLocalTx } from "../wallet/local-exec.js";
import { executeWithConfiguredWallet, requireStoredWalletConfig } from "../wallet/payer-config.js";

const GOAL_CREATE_USAGE =
  "Usage: cli goal create [--factory <address>] [--params-file <path>|--params-json <json>|--params-stdin] [--network <network>] [--agent <key>] [--idempotency-key <key>] [--dry-run]";
const GOAL_INSPECT_USAGE = "Usage: cli goal inspect <identifier>";
const GOAL_CANONICAL_TOOL_NAMES = ["get-goal", "getGoal", "goal.inspect"];

const DEFAULT_BASE_RPC_URL = "https://mainnet.base.org";

export interface GoalCreateCommandInput {
  factory?: string;
  paramsFile?: string;
  paramsJson?: string;
  paramsStdin?: boolean;
  network?: string;
  agent?: string;
  idempotencyKey?: string;
  dryRun?: boolean;
}

export interface GoalCreateCommandOutput extends Record<string, unknown> {
  idempotencyKey: string;
}

export interface GoalInspectCommandInput {
  identifier?: string;
}

export interface GoalInspectCommandOutput extends Record<string, unknown> {
  goal: unknown;
  ok?: boolean;
  untrusted: true;
  source: "remote_tool";
  warnings: string[];
}

function buildHostedGoalCreateRequest(params: {
  network: string;
  agentKey: string;
  plan: ReturnType<typeof buildGoalCreateProtocolPlan>;
}) {
  return {
    ...buildCliProtocolStepRequest({
      network: params.network,
      action: params.plan.action,
      riskClass: params.plan.riskClass,
      step: params.plan.steps[0]!,
    }),
    agentKey: params.agentKey,
  };
}

function buildLocalGoalCreateRequest(params: {
  network: string;
  agentKey: string;
  plan: ReturnType<typeof buildGoalCreateProtocolPlan>;
}) {
  const tx = params.plan.steps[0]!.transaction;
  return {
    kind: "tx" as const,
    network: params.network,
    agentKey: params.agentKey,
    to: tx.to,
    data: tx.data,
    valueEth: tx.valueEth,
  };
}

function resolveRpcUrlForNetwork(deps: Pick<CliDeps, "env">): string {
  const env = deps.env ?? process.env;
  return env.COBUILD_CLI_BASE_RPC_URL?.trim() || DEFAULT_BASE_RPC_URL;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function expectRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function assertBytes32Hex(value: unknown, label: string): void {
  if (typeof value !== "string" || !isHex(value, { strict: true }) || value.length !== 66) {
    throw new Error(`${label} must be a 32-byte hex string (0x + 64 hex chars).`);
  }
}

function assertCurrentGoalFactoryDeployShape(rawParams: Record<string, unknown>): void {
  const deployParams = extractGoalFactoryDeployParams(rawParams);
  const revnet = expectRecord(deployParams.revnet, "deployParams.revnet");
  const underwriting = expectRecord(
    deployParams.underwriting,
    "deployParams.underwriting"
  );
  const success = expectRecord(deployParams.success, "deployParams.success");
  const budgetTcr = expectRecord(deployParams.budgetTCR, "deployParams.budgetTCR");

  if (Object.hasOwn(revnet, "owner")) {
    throw new Error("deployParams.revnet.owner is not supported.");
  }
  if (Object.hasOwn(underwriting, "coverageLambda")) {
    throw new Error("deployParams.underwriting.coverageLambda is not supported.");
  }
  if (!Object.hasOwn(budgetTcr, "budgetSpendPolicy")) {
    throw new Error("deployParams.budgetTCR.budgetSpendPolicy is required.");
  }

  assertBytes32Hex(
    success.successOracleSpecHash,
    "deployParams.success.successOracleSpecHash"
  );
  assertBytes32Hex(
    success.successAssertionPolicyHash,
    "deployParams.success.successAssertionPolicyHash"
  );
}

async function tryDecodeGoalDeployment(params: {
  deps: Pick<CliDeps, "env">;
  network: string;
  txHash: string;
}): Promise<{ event: Record<string, unknown> | null; decodeError?: string }> {
  const normalizedNetwork = params.network.trim().toLowerCase();
  if (normalizedNetwork !== "base") {
    return {
      event: null,
      decodeError: `Skipping receipt decode for unsupported network "${params.network}".`,
    };
  }

  if (!isHex(params.txHash) || params.txHash.length !== 66) {
    return {
      event: null,
      decodeError: `Skipping receipt decode: invalid transaction hash "${params.txHash}".`,
    };
  }

  const rpcUrl = resolveRpcUrlForNetwork(params.deps);

  try {
    const client = createPublicClient({
      chain: base,
      transport: http(rpcUrl, {
        timeout: 20_000,
        retryCount: 1,
      }),
    });
    const receipt = await client.getTransactionReceipt({
      hash: params.txHash as Hex,
    });
    const event = decodeGoalDeployedEvent(receipt.logs as unknown[]);

    return {
      event: event ? serializeGoalDeployedEvent(event) : null,
    };
  } catch (error) {
    return {
      event: null,
      decodeError: `GoalDeployed decode failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function resolveGoalDeployParams(
  input: GoalCreateCommandInput,
  deps: Pick<CliDeps, "fs" | "readStdin">
): Promise<Record<string, unknown>> {
  const parsed = await readJsonInputObject(
    {
      json: input.paramsJson,
      file: input.paramsFile,
      stdin: input.paramsStdin,
      jsonFlag: "--params-json",
      fileFlag: "--params-file",
      stdinFlag: "--params-stdin",
      usage: GOAL_CREATE_USAGE,
      valueLabel: "Goal deploy params",
    },
    deps
  );
  if (!parsed) {
    throw new Error(`${GOAL_CREATE_USAGE}\nGoal deploy params are required.`);
  }
  assertCurrentGoalFactoryDeployShape(parsed);
  return parsed;
}

export async function executeGoalInspectCommand(
  input: GoalInspectCommandInput,
  deps: CliDeps
): Promise<GoalInspectCommandOutput> {
  const identifier = input.identifier?.trim() ?? "";
  if (!identifier) {
    throw new Error(GOAL_INSPECT_USAGE);
  }

  const response = await executeCanonicalToolOnly(deps, {
    canonicalToolNames: GOAL_CANONICAL_TOOL_NAMES,
    input: {
      identifier,
    },
  });

  return normalizeKeyedRemoteToolResponse(response, "goal") as GoalInspectCommandOutput;
}

export async function executeGoalCreateCommand(
  input: GoalCreateCommandInput,
  deps: CliDeps
): Promise<GoalCreateCommandOutput> {
  const current = readConfig(deps);
  const agentKey = resolveAgentKey(input.agent, current.agent);
  const network = resolveNetwork(input.network, deps);
  const deployParams = await resolveGoalDeployParams(input, deps);
  const factoryAddress =
    input.factory === undefined ? undefined : normalizeEvmAddress(input.factory, "--factory");
  const goalCreatePlan = buildGoalCreateProtocolPlan({
    deployParams,
    factoryAddress,
    network,
  });
  const goalCreateTx = goalCreatePlan.steps[0]!.transaction;
  const idempotencyKey = resolveExecIdempotencyKey(input.idempotencyKey, deps);

  if (input.dryRun === true) {
    const walletConfig = requireStoredWalletConfig({
      deps,
      agentKey,
    });
    const requestBody =
      walletConfig.mode === "local"
        ? buildLocalGoalCreateRequest({
            network: goalCreatePlan.network,
            agentKey,
            plan: goalCreatePlan,
          })
        : buildHostedGoalCreateRequest({
            network: goalCreatePlan.network,
            agentKey,
            plan: goalCreatePlan,
          });
    return {
      ok: true,
      dryRun: true,
      idempotencyKey,
      request: {
        method: "POST",
        path: "/api/cli/exec",
        body: requestBody,
      },
      goalFactory: goalCreatePlan.goalFactory,
      network: goalCreatePlan.network,
    } as GoalCreateCommandOutput;
  }

  const response = await executeWithConfiguredWallet({
    deps,
    currentConfig: current,
    agentKey,
    onLocal: async ({ privateKeyHex }) => {
      try {
        return await executeLocalTx({
          deps,
          agentKey,
          privateKeyHex,
          network: goalCreatePlan.network,
          to: goalCreateTx.to,
          valueEth: goalCreateTx.valueEth,
          data: goalCreateTx.data,
          idempotencyKey,
        });
      } catch (error) {
        throwWithIdempotencyKey(error, idempotencyKey);
      }
    },
    onHosted: async () => {
      try {
        const requestBody = buildHostedGoalCreateRequest({
          network: goalCreatePlan.network,
          agentKey,
          plan: goalCreatePlan,
        });
        return await apiPost(
          deps,
          "/api/cli/exec",
          requestBody,
          {
            headers: buildIdempotencyHeaders(idempotencyKey),
          }
        );
      } catch (error) {
        throwWithIdempotencyKey(error, idempotencyKey);
      }
    },
  });

  const output = withIdempotencyKey(idempotencyKey, response) as GoalCreateCommandOutput;
  output.goalFactory = goalCreatePlan.goalFactory;
  output.network = goalCreatePlan.network;

  const responseRecord = asRecord(response);
  const txHash = typeof responseRecord.transactionHash === "string" ? responseRecord.transactionHash : null;
  if (!txHash) {
    return output;
  }

  const decoded = await tryDecodeGoalDeployment({
    deps,
    network: goalCreatePlan.network,
    txHash,
  });
  if (decoded.event) {
    output.goalDeployment = decoded.event;
  } else if (decoded.decodeError) {
    output.goalDeploymentDecodeError = decoded.decodeError;
  }

  return output;
}
