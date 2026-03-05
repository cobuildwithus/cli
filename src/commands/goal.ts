import { base, baseSepolia } from "viem/chains";
import {
  createPublicClient,
  encodeFunctionData,
  getAddress,
  http,
  isHex,
  parseEventLogs,
  type Abi,
  type Hex,
} from "viem";
import { goalFactoryAbi as goalFactoryAbiFromWire } from "@cobuild/wire";
import { readConfig } from "../config.js";
import { asRecord, apiPost } from "../transport.js";
import type { CliDeps } from "../types.js";
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
import { executeLocalTx } from "../wallet/local-exec.js";
import { executeWithConfiguredWallet } from "../wallet/payer-config.js";

const GOAL_CREATE_USAGE =
  "Usage: cli goal create --factory <address> [--params-file <path>|--params-json <json>|--params-stdin] [--network <network>] [--agent <key>] [--idempotency-key <key>] [--dry-run]";
const GOAL_DEPLOY_REQUIRED_KEYS = [
  "revnet",
  "timing",
  "success",
  "flowMetadata",
  "underwriting",
  "budgetTCR",
] as const;

const DEFAULT_BASE_RPC_URL = "https://mainnet.base.org";
const DEFAULT_BASE_SEPOLIA_RPC_URL = "https://sepolia.base.org";

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function isGoalDeployParamsShape(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  return GOAL_DEPLOY_REQUIRED_KEYS.every((key) => hasOwn(value, key));
}

function extractDeployParams(raw: Record<string, unknown>): Record<string, unknown> {
  if (isGoalDeployParamsShape(raw)) return raw;

  for (const key of ["deployParams", "params", "p"]) {
    const nested = raw[key];
    if (isGoalDeployParamsShape(nested)) {
      return nested;
    }
  }

  throw new Error(
    "Goal deploy params must include keys: revnet, timing, success, flowMetadata, underwriting, budgetTCR."
  );
}

function resolveRpcUrlForNetwork(
  network: "base" | "base-sepolia",
  deps: Pick<CliDeps, "env">
): string {
  const env = deps.env ?? process.env;
  if (network === "base") {
    return env.COBUILD_CLI_BASE_RPC_URL?.trim() || DEFAULT_BASE_RPC_URL;
  }
  return env.COBUILD_CLI_BASE_SEPOLIA_RPC_URL?.trim() || DEFAULT_BASE_SEPOLIA_RPC_URL;
}

function parseGoalDeploymentLog(
  abi: Abi,
  logs: readonly Record<string, unknown>[]
): Record<string, unknown> | null {
  const parsed = parseEventLogs({
    abi,
    logs: logs as any[],
    eventName: "GoalDeployed",
    strict: false,
  });
  const latest = parsed.at(-1);
  if (!latest) return null;

  return normalizeBigInts(latest.args as unknown) as Record<string, unknown>;
}

function normalizeBigInts(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString(10);
  if (Array.isArray(value)) return value.map((entry) => normalizeBigInts(entry));
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, normalizeBigInts(entry)])
    );
  }
  return value;
}

async function tryDecodeGoalDeployment(params: {
  deps: Pick<CliDeps, "env">;
  network: string;
  txHash: string;
  goalFactoryAbi: Abi;
}): Promise<{ event: Record<string, unknown> | null; decodeError?: string }> {
  const normalizedNetwork = params.network.trim().toLowerCase();
  if (normalizedNetwork !== "base" && normalizedNetwork !== "base-sepolia") {
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

  const chain = normalizedNetwork === "base" ? base : baseSepolia;
  const rpcUrl = resolveRpcUrlForNetwork(normalizedNetwork, params.deps);

  try {
    const client = createPublicClient({
      chain,
      transport: http(rpcUrl, {
        timeout: 20_000,
        retryCount: 1,
      }),
    });
    const receipt = await client.getTransactionReceipt({
      hash: params.txHash as Hex,
    });

    return {
      event: parseGoalDeploymentLog(params.goalFactoryAbi, receipt.logs as unknown as Record<string, unknown>[]),
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
  return extractDeployParams(parsed);
}

export async function executeGoalCreateCommand(
  input: GoalCreateCommandInput,
  deps: CliDeps
): Promise<GoalCreateCommandOutput> {
  if (!input.factory) {
    throw new Error(GOAL_CREATE_USAGE);
  }

  const goalFactoryAddress = normalizeEvmAddress(input.factory, "--factory");
  const goalFactoryAbi = goalFactoryAbiFromWire as unknown as Abi;
  const deployParams = await resolveGoalDeployParams(input, deps);
  let data: Hex;
  try {
    data = encodeFunctionData({
      abi: goalFactoryAbi,
      functionName: "deployGoal",
      args: [deployParams],
    });
  } catch (error) {
    throw new Error(
      `Goal deploy params are invalid for GoalFactory.deployGoal: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  const current = readConfig(deps);
  const agentKey = resolveAgentKey(input.agent, current.agent);
  const network = resolveNetwork(input.network, deps);
  const idempotencyKey = resolveExecIdempotencyKey(input.idempotencyKey, deps);
  const requestBody = {
    kind: "tx",
    network,
    agentKey,
    to: goalFactoryAddress,
    data,
    valueEth: "0",
  };

  if (input.dryRun === true) {
    return {
      ok: true,
      dryRun: true,
      idempotencyKey,
      request: {
        method: "POST",
        path: "/api/cli/exec",
        body: requestBody,
      },
      goalFactory: getAddress(goalFactoryAddress).toLowerCase(),
      network,
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
          network,
          to: goalFactoryAddress,
          valueEth: "0",
          data,
          idempotencyKey,
        });
      } catch (error) {
        throwWithIdempotencyKey(error, idempotencyKey);
      }
    },
    onHosted: async () => {
      try {
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
  output.goalFactory = getAddress(goalFactoryAddress).toLowerCase();
  output.network = network;

  const responseRecord = asRecord(response);
  const txHash = typeof responseRecord.transactionHash === "string" ? responseRecord.transactionHash : null;
  if (!txHash) {
    return output;
  }

  const decoded = await tryDecodeGoalDeployment({
    deps,
    network,
    txHash,
    goalFactoryAbi,
  });
  if (decoded.event) {
    output.goalDeployment = decoded.event;
  } else if (decoded.decodeError) {
    output.goalDeploymentDecodeError = decoded.decodeError;
  }

  return output;
}
