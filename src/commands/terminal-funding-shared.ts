import type {
  ProtocolExecutionPlanLike,
  ProtocolPlanExecutionOutput,
} from "../protocol-plan/types.js";
import { executeProtocolPlan } from "../protocol-plan/runner.js";
import type { CliDeps } from "../types.js";
import {
  readJsonInputObject,
  resolveNetwork,
} from "./shared.js";

export interface TerminalFundingExecutionInput {
  agent?: string;
  dryRun?: boolean;
  idempotencyKey?: string;
  network?: string;
}

export interface TerminalFundingJsonCommandInput extends TerminalFundingExecutionInput {
  inputJson?: string;
  inputFile?: string;
  inputStdin?: boolean;
}

export type TerminalFundingCommandOutput<TFamily extends string = string> =
  ProtocolPlanExecutionOutput & {
    family: TFamily;
  };

export function readRequiredStringFromInputJson(
  payload: Record<string, unknown>,
  key: string,
  label: string
): string {
  const value = payload[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} "${key}" must be a non-empty string.`);
  }
  return value.trim();
}

export function readOptionalStringFromInputJson(
  payload: Record<string, unknown>,
  key: string,
  label: string
): string | undefined {
  const value = payload[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} "${key}" must be a non-empty string when provided.`);
  }
  return value.trim();
}

export function readRequiredBigintLikeFromInputJson(
  payload: Record<string, unknown>,
  key: string,
  label: string
): string | number | bigint {
  const value = payload[key];
  if (typeof value === "string") {
    if (value.trim().length === 0) {
      throw new Error(`${label} "${key}" must be a non-negative integer.`);
    }
    return value.trim();
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
      throw new Error(`${label} "${key}" must be a non-negative integer.`);
    }
    return value;
  }
  if (typeof value === "bigint") {
    if (value < 0n) {
      throw new Error(`${label} "${key}" must be a non-negative integer.`);
    }
    return value;
  }
  throw new Error(`${label} "${key}" must be a non-negative integer.`);
}

export function readOptionalBigintLikeFromInputJson(
  payload: Record<string, unknown>,
  key: string,
  label: string
): string | number | bigint | undefined {
  const value = payload[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  return readRequiredBigintLikeFromInputJson(payload, key, label);
}

export function readOptionalRecordFromInputJson(
  payload: Record<string, unknown>,
  key: string,
  label: string
): Record<string, unknown> | undefined {
  const value = payload[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} "${key}" must be an object when provided.`);
  }
  return value as Record<string, unknown>;
}

export function readOptionalBigintLikeArrayFromInputJson(
  payload: Record<string, unknown>,
  key: string,
  label: string
): Array<string | number | bigint> | undefined {
  const value = payload[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(`${label} "${key}" must be an array when provided.`);
  }

  return value.map((entry, index) => {
    if (typeof entry === "string") {
      if (entry.trim().length === 0) {
        throw new Error(`${label} "${key}[${index}]" must be a non-negative integer.`);
      }
      return entry.trim();
    }
    if (typeof entry === "number") {
      if (!Number.isFinite(entry) || !Number.isInteger(entry) || entry < 0) {
        throw new Error(`${label} "${key}[${index}]" must be a non-negative integer.`);
      }
      return entry;
    }
    if (typeof entry === "bigint") {
      if (entry < 0n) {
        throw new Error(`${label} "${key}[${index}]" must be a non-negative integer.`);
      }
      return entry;
    }
    throw new Error(`${label} "${key}[${index}]" must be a non-negative integer.`);
  });
}

export async function readRequiredJsonCommandInput(
  input: TerminalFundingJsonCommandInput,
  deps: Pick<CliDeps, "fs" | "readStdin">,
  params: {
    usage: string;
    valueLabel: string;
  }
): Promise<Record<string, unknown>> {
  const payload = await readJsonInputObject(
    {
      json: input.inputJson,
      file: input.inputFile,
      stdin: input.inputStdin,
      jsonFlag: "--input-json",
      fileFlag: "--input-file",
      stdinFlag: "--input-stdin",
      usage: params.usage,
      valueLabel: params.valueLabel,
    },
    deps
  );

  if (!payload) {
    throw new Error(`${params.usage}\n${params.valueLabel} is required.`);
  }
  return payload;
}

function formatTerminalFundingResumeHint(rootIdempotencyKey: string): string {
  return `Re-run the same command with the same JSON payload and idempotencyKey ${rootIdempotencyKey} to resume safely.`;
}

function formatTerminalFundingPendingMessage(params: {
  displayLabel: string;
  stepIdempotencyKey: string;
  rootIdempotencyKey: string;
  userOpHash: string;
}): string {
  return `${params.displayLabel} is still pending on the hosted wallet (step idempotency key: ${params.stepIdempotencyKey}, root idempotency key: ${params.rootIdempotencyKey}, userOpHash: ${params.userOpHash}). ${formatTerminalFundingResumeHint(params.rootIdempotencyKey)}`;
}

function formatTerminalFundingStepFailureMessage(params: {
  displayLabel: string;
  stepIdempotencyKey: string;
  rootIdempotencyKey: string;
  cause: unknown;
}): string {
  const message = params.cause instanceof Error ? params.cause.message : String(params.cause);
  return `${params.displayLabel} failed: ${message} (step idempotency key: ${params.stepIdempotencyKey}, root idempotency key: ${params.rootIdempotencyKey}). ${formatTerminalFundingResumeHint(params.rootIdempotencyKey)}`;
}

export async function executeTerminalFundingPlan<TFamily extends string>(params: {
  deps: CliDeps;
  family: TFamily;
  input: TerminalFundingExecutionInput;
  plan: ProtocolExecutionPlanLike;
  outputAction?: string;
}): Promise<TerminalFundingCommandOutput<TFamily>> {
  const execution = await executeProtocolPlan({
    deps: params.deps,
    plan: params.plan,
    mode: "raw-tx",
    agent: params.input.agent,
    dryRun: params.input.dryRun,
    idempotencyKey: params.input.idempotencyKey,
    resolvePlanNetwork: (plan, deps) => resolveNetwork(params.input.network ?? plan.network, deps),
    formatStepFailureMessage: formatTerminalFundingStepFailureMessage,
    formatPendingMessage: formatTerminalFundingPendingMessage,
  });

  return {
    ...execution,
    family: params.family,
    action: params.outputAction ?? params.plan.action,
  };
}
