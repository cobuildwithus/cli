import { readConfig } from "../config.js";
import { apiPost } from "../transport.js";
import type { CliDeps } from "../types.js";
import {
  buildIdempotencyHeaders,
  normalizeEvmAddress,
  resolveAgentKey,
  resolveExecIdempotencyKey,
  resolveNetwork,
  throwWithIdempotencyKey,
  validateHexData,
  validateNonNegativeDecimal,
  withIdempotencyKey,
} from "./shared.js";
import { executeLocalTx } from "../wallet/local-exec.js";
import { executeWithConfiguredWallet } from "../wallet/payer-config.js";

const TX_USAGE =
  "Usage: cli tx --to <address> --data <hex> [--value] [--network] [--agent] [--idempotency-key]";

export interface TxCommandInput {
  to?: string;
  data?: string;
  value?: string;
  network?: string;
  agent?: string;
  idempotencyKey?: string;
}

export interface TxCommandOutput extends Record<string, unknown> {
  idempotencyKey: string;
}

export async function executeTxCommand(input: TxCommandInput, deps: CliDeps): Promise<TxCommandOutput> {
  if (!input.to || !input.data) {
    throw new Error(TX_USAGE);
  }
  const data = input.data;
  const normalizedTo = normalizeEvmAddress(input.to, "--to");
  validateHexData(data, "--data");

  const valueEth = input.value ?? "0";
  validateNonNegativeDecimal(valueEth, "--value");

  const current = readConfig(deps);
  const agentKey = resolveAgentKey(input.agent, current.agent);
  const network = resolveNetwork(input.network, deps);
  const idempotencyKey = resolveExecIdempotencyKey(input.idempotencyKey, deps);

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
          to: normalizedTo,
          valueEth,
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
          {
            kind: "tx",
            network,
            agentKey,
            to: normalizedTo,
            data,
            valueEth,
          },
          {
            headers: buildIdempotencyHeaders(idempotencyKey),
          }
        );
      } catch (error) {
        throwWithIdempotencyKey(error, idempotencyKey);
      }
    },
  });

  return withIdempotencyKey(idempotencyKey, response) as TxCommandOutput;
}
