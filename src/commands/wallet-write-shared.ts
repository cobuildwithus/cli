import { readConfig } from "../config.js";
import type { HexString, StoredX402PayerConfig } from "../farcaster/types.js";
import { apiPost } from "../transport.js";
import type { CliConfig, CliDeps } from "../types.js";
import { executeWithConfiguredWallet } from "../wallet/payer-config.js";
import {
  buildIdempotencyHeaders,
  resolveAgentKey,
  resolveExecIdempotencyKey,
  resolveNetwork,
  throwWithIdempotencyKey,
  withIdempotencyKey,
} from "./shared.js";

export interface WalletWriteExecutionInput {
  agent?: string;
  network?: string;
  idempotencyKey?: string;
}

export interface WalletWriteExecutionContext {
  currentConfig: CliConfig;
  agentKey: string;
  network: string;
  idempotencyKey: string;
}

export function resolveWalletWriteExecutionContext(
  input: WalletWriteExecutionInput,
  deps: Pick<CliDeps, "env" | "fs" | "homedir" | "randomUUID">
): WalletWriteExecutionContext {
  const currentConfig = readConfig(deps);
  return {
    currentConfig,
    agentKey: resolveAgentKey(input.agent, currentConfig.agent),
    network: resolveNetwork(input.network, deps),
    idempotencyKey: resolveExecIdempotencyKey(input.idempotencyKey, deps),
  };
}

export function buildExecDryRunOutput<TBody extends Record<string, unknown>>(params: {
  idempotencyKey: string;
  requestBody: TBody;
}): Record<string, unknown> {
  return {
    ok: true,
    dryRun: true,
    idempotencyKey: params.idempotencyKey,
    request: {
      method: "POST",
      path: "/api/cli/exec",
      body: params.requestBody,
    },
  };
}

export async function executeWalletWrite(params: {
  deps: Pick<CliDeps, "env" | "fetch" | "fs" | "homedir">;
  context: WalletWriteExecutionContext;
  requestBody: Record<string, unknown>;
  onLocal: (context: { walletConfig: StoredX402PayerConfig; privateKeyHex: HexString }) => Promise<unknown>;
}): Promise<Record<string, unknown>> {
  return (await executeWithConfiguredWallet({
    deps: params.deps,
    currentConfig: params.context.currentConfig,
    agentKey: params.context.agentKey,
    onLocal: async (localContext) => {
      try {
        return await params.onLocal(localContext);
      } catch (error) {
        throwWithIdempotencyKey(error, params.context.idempotencyKey);
      }
    },
    onHosted: async () => {
      try {
        return await apiPost(
          params.deps,
          "/api/cli/exec",
          params.requestBody,
          {
            headers: buildIdempotencyHeaders(params.context.idempotencyKey),
          }
        );
      } catch (error) {
        throwWithIdempotencyKey(error, params.context.idempotencyKey);
      }
    },
  })) as Record<string, unknown>;
}

export async function executeWalletWriteCommand<TOutput extends Record<string, unknown>>(params: {
  deps: CliDeps;
  input: WalletWriteExecutionInput & { dryRun?: boolean };
  buildRequestBody: (context: WalletWriteExecutionContext) => Record<string, unknown>;
  onLocal: (context: {
    walletConfig: StoredX402PayerConfig;
    privateKeyHex: HexString;
    execution: WalletWriteExecutionContext;
  }) => Promise<unknown>;
}): Promise<TOutput> {
  const execution = resolveWalletWriteExecutionContext(params.input, params.deps);
  const requestBody = params.buildRequestBody(execution);

  if (params.input.dryRun === true) {
    return buildExecDryRunOutput({
      idempotencyKey: execution.idempotencyKey,
      requestBody,
    }) as TOutput;
  }

  const response = await executeWalletWrite({
    deps: params.deps,
    context: execution,
    requestBody,
    onLocal: (localContext) =>
      params.onLocal({
        ...localContext,
        execution,
      }),
  });

  return withIdempotencyKey(execution.idempotencyKey, response) as TOutput;
}
