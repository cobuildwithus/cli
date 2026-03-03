import { readConfig } from "../config.js";
import { apiPost } from "../transport.js";
import type { CliDeps } from "../types.js";
import {
  buildIdempotencyHeaders,
  normalizeEvmAddress,
  parseIntegerOption,
  resolveAgentKey,
  resolveExecIdempotencyKey,
  resolveNetwork,
  throwWithIdempotencyKey,
  validateNonNegativeDecimal,
  withIdempotencyKey,
} from "./shared.js";
import { readStoredX402PayerConfig, resolveLocalPayerPrivateKey } from "../farcaster/payer.js";
import { executeLocalTransfer } from "../wallet/local-exec.js";

const SEND_USAGE =
  "Usage: cli send <token> <amount> <to> [--network] [--decimals] [--agent] [--idempotency-key]";

export interface SendCommandInput {
  token?: string;
  amount?: string;
  to?: string;
  network?: string;
  decimals?: string;
  agent?: string;
  idempotencyKey?: string;
}

export interface SendCommandOutput extends Record<string, unknown> {
  idempotencyKey: string;
}

export async function executeSendCommand(input: SendCommandInput, deps: CliDeps): Promise<SendCommandOutput> {
  const token = input.token;
  const amount = input.amount;
  const to = input.to;
  if (!token || !amount || !to) {
    throw new Error(SEND_USAGE);
  }

  const decimals = parseIntegerOption(input.decimals, "--decimals");
  if (decimals !== undefined && (decimals < 0 || decimals > 255)) {
    throw new Error("--decimals must be between 0 and 255");
  }
  validateNonNegativeDecimal(amount, "amount");
  const normalizedTo = normalizeEvmAddress(to, "to");

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
      response = await executeLocalTransfer({
        deps,
        agentKey,
        privateKeyHex,
        network,
        token,
        amount,
        to: normalizedTo,
        decimals,
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
          kind: "transfer",
          network,
          agentKey,
          token,
          amount,
          to: normalizedTo,
          decimals,
        },
        {
          headers: buildIdempotencyHeaders(idempotencyKey),
        }
      );
    } catch (error) {
      throwWithIdempotencyKey(error, idempotencyKey);
    }
  }

  return withIdempotencyKey(idempotencyKey, response) as SendCommandOutput;
}
