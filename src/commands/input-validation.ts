import type { CliDeps } from "../types.js";
import { readJsonInputObject } from "./shared.js";

export interface JsonInputSource {
  inputJson?: string;
  inputFile?: string;
  inputStdin?: boolean;
}

export async function resolveJsonOrFlagInput<T>(params: {
  input: JsonInputSource;
  deps: Pick<CliDeps, "fs" | "readStdin">;
  usage: string;
  valueLabel: string;
  hasConflictingOptions: boolean;
  conflictMessage: string;
  resolveFlags: () => T;
  resolveJson: (payload: Record<string, unknown>) => T;
}): Promise<T> {
  const payload = await readJsonInputObject(
    {
      json: params.input.inputJson,
      file: params.input.inputFile,
      stdin: params.input.inputStdin,
      jsonFlag: "--input-json",
      fileFlag: "--input-file",
      stdinFlag: "--input-stdin",
      usage: params.usage,
      valueLabel: params.valueLabel,
    },
    params.deps
  );

  if (!payload) {
    return params.resolveFlags();
  }

  if (params.hasConflictingOptions) {
    throw new Error(`${params.usage}\n${params.conflictMessage}`);
  }

  return params.resolveJson(payload);
}

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

export function readOptionalStringOrIntegerFromInputJson(
  payload: Record<string, unknown>,
  key: string,
  label: string
): string | undefined {
  const value = payload[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "number") {
    if (!Number.isInteger(value)) {
      throw new Error(`${label} "${key}" must be an integer.`);
    }
    return String(value);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  throw new Error(`${label} "${key}" must be a string or integer.`);
}
