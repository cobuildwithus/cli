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
import { readStoredX402PayerConfig, resolveLocalPayerPrivateKey } from "../farcaster/payer.js";
import { executeLocalTx } from "../wallet/local-exec.js";

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
  const normalizedTo = normalizeEvmAddress(input.to, "--to");
  validateHexData(input.data, "--data");

  const valueEth = input.value ?? "0";
  validateNonNegativeDecimal(valueEth, "--value");

  const current = readConfig(deps);
  const agentKey = resolveAgentKey(input.agent, current.agent);
  const network = resolveNetwork(input.network, deps);
  const idempotencyKey = resolveExecIdempotencyKey(input.idempotencyKey, deps);
  const walletConfig = readStoredX402PayerConfig({
    deps,
    agentKey,
  });
  if (!walletConfig) {
    throw new Error(
      "No wallet is configured for this agent. Run `cli wallet init --mode hosted|local-generate|local-key`."
    );
  }

  let response: unknown;
  if (walletConfig.mode === "local") {
    const privateKeyHex = resolveLocalPayerPrivateKey({
      deps,
      currentConfig: current,
      payerConfig: walletConfig,
    });
    try {
      response = await executeLocalTx({
        deps,
        agentKey,
        privateKeyHex,
        network,
        to: normalizedTo,
        valueEth,
        data: input.data,
        idempotencyKey,
      });
    } catch (error) {
      throwWithIdempotencyKey(error, idempotencyKey);
    }
  } else {
    try {
      response = await apiPost(
        deps,
        "/api/cli/exec",
        {
          kind: "tx",
          network,
          agentKey,
          to: normalizedTo,
          data: input.data,
          valueEth,
        },
        {
          headers: buildIdempotencyHeaders(idempotencyKey),
        }
      );
    } catch (error) {
      throwWithIdempotencyKey(error, idempotencyKey);
    }
  }

  return withIdempotencyKey(idempotencyKey, response) as TxCommandOutput;
}
