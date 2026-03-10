import { createHash } from "node:crypto";
import type { ProtocolExecutionPlanLike, ProtocolPlanStepLike } from "./types.js";

function formatUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

function protocolPlanStepSeed(params: {
  rootIdempotencyKey: string;
  plan: ProtocolExecutionPlanLike;
  step: ProtocolPlanStepLike;
  stepNumber: number;
}): string {
  const normalizedNetwork = canonicalizeProtocolPlanNetwork(params.plan.network);
  const parts = [
    "protocol-plan-step",
    params.rootIdempotencyKey,
    params.plan.action,
    normalizedNetwork,
    String(params.stepNumber),
    params.step.kind,
    params.step.label,
    params.step.transaction.to,
    params.step.transaction.data,
    params.step.transaction.valueEth,
  ];

  if (params.step.kind === "contract-call") {
    parts.push(params.step.contract, params.step.functionName);
  } else {
    parts.push(params.step.tokenAddress, params.step.spenderAddress, params.step.amount);
  }

  return parts.join("\n");
}

function canonicalizeProtocolPlanNetwork(network: string): string {
  const normalized = network.trim().toLowerCase();
  if (normalized === "base-mainnet") {
    return "base";
  }
  return normalized;
}

export function deriveProtocolPlanStepIdempotencyKey(params: {
  rootIdempotencyKey: string;
  plan: ProtocolExecutionPlanLike;
  step: ProtocolPlanStepLike;
  stepNumber: number;
}): string {
  const hash = createHash("sha256").update(protocolPlanStepSeed(params)).digest();
  const bytes = Uint8Array.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return formatUuid(bytes);
}
