import { createPublicClient, http, isHex, type Hex } from "viem";
import { base } from "viem/chains";
import { defaultRpcUrlForNetwork } from "@cobuild/wire";
import type { CliDeps } from "../types.js";
import type {
  ProtocolExecutionPlanLike,
  ProtocolPlanStepLike,
  ProtocolPlanStepReceiptDecoder,
} from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function serializeBigInts(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString(10);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => serializeBigInts(entry));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, serializeBigInts(entry)])
    );
  }
  return value;
}

function serializeReceiptSummary(summary: unknown): Record<string, unknown> {
  const serialized = serializeBigInts(summary);
  return isRecord(serialized) ? serialized : { summary: serialized };
}

function resolveProtocolReceiptRpcUrl(params: {
  deps: Pick<CliDeps, "env">;
  network: string;
}): string {
  const normalizedNetwork = params.network.trim().toLowerCase();
  if (normalizedNetwork === "base") {
    return params.deps.env?.COBUILD_CLI_BASE_RPC_URL?.trim() || defaultRpcUrlForNetwork("base");
  }
  throw new Error(`Unsupported network "${params.network}". Only "base" is supported.`);
}

export async function tryDecodeProtocolPlanStepReceipt(params: {
  deps: Pick<CliDeps, "env">;
  network: string;
  transactionHash: string;
  plan: ProtocolExecutionPlanLike;
  step: ProtocolPlanStepLike;
  stepNumber: number;
  decoder: ProtocolPlanStepReceiptDecoder;
}): Promise<{
  receiptSummary?: Record<string, unknown>;
  receiptDecodeError?: string;
}> {
  const normalizedNetwork = params.network.trim().toLowerCase();
  if (normalizedNetwork !== "base") {
    return {
      receiptDecodeError: `Skipping receipt decode for unsupported network "${params.network}".`,
    };
  }

  if (!isHex(params.transactionHash, { strict: true }) || params.transactionHash.length !== 66) {
    return {
      receiptDecodeError: `Skipping receipt decode: invalid transaction hash "${params.transactionHash}".`,
    };
  }

  try {
    const client = createPublicClient({
      chain: base,
      transport: http(resolveProtocolReceiptRpcUrl(params), {
        timeout: 20_000,
        retryCount: 1,
      }),
    });
    const receipt = await client.getTransactionReceipt({
      hash: params.transactionHash as Hex,
    });
    const summary = await params.decoder.decode({
      logs: receipt.logs as unknown[],
      plan: params.plan,
      step: params.step,
      stepNumber: params.stepNumber,
      transactionHash: params.transactionHash,
    });
    if (summary === null || summary === undefined) {
      return {};
    }

    return {
      receiptSummary: params.decoder.serialize
        ? params.decoder.serialize(summary)
        : serializeReceiptSummary(summary),
    };
  } catch (error) {
    return {
      receiptDecodeError: `Receipt decode failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
