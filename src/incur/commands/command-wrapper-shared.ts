import type { CliDeps } from "../../types.js";

type CommandExecutor<TInput, TOutput> = (input: TInput, deps: CliDeps) => Promise<TOutput> | TOutput;

export interface CommandSchemaMetadata {
  mutating: boolean;
  supportsDryRun: boolean;
  requiresAuth: boolean;
  sideEffects: string[];
}

export interface RegisteredCommandMetadata {
  commandPath: string;
  metadata: CommandSchemaMetadata;
}

export const DEFAULT_COMMAND_SCHEMA_METADATA: CommandSchemaMetadata = {
  mutating: false,
  supportsDryRun: false,
  requiresAuth: false,
  sideEffects: [],
};

export const LOCAL_FILE_WRITE_SCHEMA_METADATA: CommandSchemaMetadata = {
  mutating: true,
  supportsDryRun: false,
  requiresAuth: false,
  sideEffects: ["writes_local_files"],
};

export const LOCAL_FILE_READ_SCHEMA_METADATA: CommandSchemaMetadata = {
  mutating: false,
  supportsDryRun: false,
  requiresAuth: false,
  sideEffects: ["reads_local_files"],
};

export const NETWORK_READ_SCHEMA_METADATA: CommandSchemaMetadata = {
  mutating: false,
  supportsDryRun: false,
  requiresAuth: true,
  sideEffects: ["network"],
};

export const NETWORK_AND_LOCAL_READ_SCHEMA_METADATA: CommandSchemaMetadata = {
  mutating: false,
  supportsDryRun: false,
  requiresAuth: true,
  sideEffects: ["network", "reads_local_files"],
};

export const NETWORK_WRITE_SCHEMA_METADATA: CommandSchemaMetadata = {
  mutating: true,
  supportsDryRun: true,
  requiresAuth: true,
  sideEffects: ["network", "onchain_transaction"],
};

export const NETWORK_AND_LOCAL_WRITE_SCHEMA_METADATA: CommandSchemaMetadata = {
  mutating: true,
  supportsDryRun: true,
  requiresAuth: true,
  sideEffects: ["network", "writes_local_files"],
};

export const NETWORK_AND_LOCAL_SETUP_SCHEMA_METADATA: CommandSchemaMetadata = {
  mutating: true,
  supportsDryRun: false,
  requiresAuth: false,
  sideEffects: ["network", "writes_local_files"],
};

export const NETWORK_AND_LOCAL_AUTH_WRITE_SCHEMA_METADATA: CommandSchemaMetadata = {
  mutating: true,
  supportsDryRun: false,
  requiresAuth: true,
  sideEffects: ["network", "writes_local_files"],
};

export const INTROSPECTION_SCHEMA_METADATA: CommandSchemaMetadata = {
  mutating: false,
  supportsDryRun: false,
  requiresAuth: false,
  sideEffects: ["introspection"],
};

export function normalizeCommandPath(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function commandMetadata(
  commandPath: string,
  metadata: CommandSchemaMetadata
): RegisteredCommandMetadata {
  return {
    commandPath,
    metadata,
  };
}

export function addRegisteredCommandMetadata(
  metadataByCommand: Map<string, CommandSchemaMetadata>,
  entries: readonly RegisteredCommandMetadata[]
): void {
  for (const entry of entries) {
    metadataByCommand.set(normalizeCommandPath(entry.commandPath), entry.metadata);
  }
}

export function forwardOptionsToExecutor<
  TOptions extends Record<string, unknown>,
  TOutput,
>(deps: CliDeps, executor: CommandExecutor<TOptions, TOutput>) {
  return (context: { options: TOptions }) => executor(context.options, deps) as Promise<TOutput>;
}

export function mapOptionsToExecutor<
  TOptions extends Record<string, unknown>,
  TInput,
  TOutput,
>(deps: CliDeps, executor: CommandExecutor<TInput, TOutput>, map: (options: TOptions) => TInput) {
  return (context: { options: TOptions }) => executor(map(context.options), deps) as Promise<TOutput>;
}
