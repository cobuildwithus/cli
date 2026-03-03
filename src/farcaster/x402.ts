import { randomBytes } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import { apiPost, asRecord } from "../transport.js";
import type { CliDeps } from "../types.js";
import {
  BASE_CHAIN_ID,
  USDC_EIP712_DOMAIN_NAME,
  USDC_EIP712_DOMAIN_VERSION,
  X402_AUTH_TTL_SECONDS,
  X402_AUTH_VALID_AFTER,
  X402_NETWORK,
  X402_PAY_TO_ADDRESS,
  X402_SCHEME,
  X402_USDC_CONTRACT,
  X402_VALUE_MICRO_USDC,
  X402_VERSION,
} from "./constants.js";
import type {
  HexString,
  ResolvedPostPayer,
  X402PaymentHeader,
} from "./types.js";

function buildAuthorizationNonce(): HexString {
  return (`0x${randomBytes(32).toString("hex")}` as HexString);
}

async function buildLocalX402PaymentHeader(params: {
  expectedAgentKey: string;
  payerAddress: string;
  privateKeyHex: HexString;
}): Promise<X402PaymentHeader> {
  const account = privateKeyToAccount(params.privateKeyHex);
  if (params.payerAddress.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error("Local payer config mismatch: payerAddress does not match private key.");
  }
  const nonce = buildAuthorizationNonce();
  const validBefore = Math.floor(Date.now() / 1000) + X402_AUTH_TTL_SECONDS;
  const authorization = {
    from: account.address,
    to: X402_PAY_TO_ADDRESS as HexString,
    value: X402_VALUE_MICRO_USDC,
    validAfter: X402_AUTH_VALID_AFTER,
    validBefore: String(validBefore),
    nonce,
  };

  const signature = await account.signTypedData({
    domain: {
      name: USDC_EIP712_DOMAIN_NAME,
      version: USDC_EIP712_DOMAIN_VERSION,
      chainId: BASE_CHAIN_ID,
      verifyingContract: X402_USDC_CONTRACT,
    },
    types: {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "TransferWithAuthorization",
    message: {
      from: authorization.from,
      to: authorization.to,
      value: BigInt(authorization.value),
      validAfter: BigInt(authorization.validAfter),
      validBefore: BigInt(authorization.validBefore),
      nonce: authorization.nonce,
    },
  });

  const xPaymentPayload = {
    x402Version: X402_VERSION,
    scheme: X402_SCHEME,
    network: X402_NETWORK,
    payload: {
      signature,
      authorization,
    },
  };

  return {
    xPayment: Buffer.from(JSON.stringify(xPaymentPayload)).toString("base64"),
    payerAddress: params.payerAddress,
    payerAgentKey: params.expectedAgentKey,
    x402Token: X402_USDC_CONTRACT,
    x402Amount: X402_VALUE_MICRO_USDC,
    x402Network: X402_NETWORK,
  };
}

async function requestHostedX402PaymentHeader(params: {
  deps: Pick<CliDeps, "fetch" | "fs" | "homedir">;
  expectedAgentKey: string;
  fallbackPayerAddress: string | null;
}): Promise<X402PaymentHeader> {
  const response = await apiPost(params.deps, "/api/cli/farcaster/x402-payment", {});
  const payload = asRecord(response);
  const result = asRecord(payload.result);
  const xPayment =
    (typeof result.xPayment === "string" ? result.xPayment : null) ??
    (typeof payload.xPayment === "string" ? payload.xPayment : null);

  if (!xPayment) {
    throw new Error("Build-bot x402 payment response did not include xPayment.");
  }

  const payerAddress =
    (typeof result.payerAddress === "string" ? result.payerAddress : null) ??
    params.fallbackPayerAddress;
  const payerAgentKey = typeof result.agentKey === "string" ? result.agentKey.trim() : "";
  if (!payerAgentKey) {
    throw new Error("Build-bot x402 payment response did not include agentKey.");
  }
  if (payerAgentKey !== params.expectedAgentKey) {
    throw new Error(
      `Configured agent (${params.expectedAgentKey}) does not match authenticated token agent (${payerAgentKey}). Update CLI config or use a token for the same agent.`
    );
  }

  return {
    xPayment,
    payerAddress,
    payerAgentKey,
    x402Token: typeof result.token === "string" ? result.token : null,
    x402Amount: typeof result.amount === "string" ? result.amount : null,
    x402Network: typeof result.network === "string" ? result.network : null,
  };
}

function validateX402PaymentPayload(xPaymentBase64: string, source: "local" | "hosted"): void {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(xPaymentBase64, "base64").toString("utf-8"));
  } catch {
    throw new Error(`x402 payment header from ${source} source is not valid base64 JSON.`);
  }

  if (typeof decoded !== "object" || decoded === null) {
    throw new Error(`x402 payment header from ${source} source is not a JSON object.`);
  }

  const payload = decoded as Record<string, unknown>;

  if (payload.network !== X402_NETWORK) {
    throw new Error(
      `x402 payment header network mismatch: expected "${X402_NETWORK}", got "${String(payload.network)}".`
    );
  }

  const inner = payload.payload as Record<string, unknown> | undefined;
  const auth = inner?.authorization as Record<string, unknown> | undefined;
  if (!auth) {
    throw new Error(`x402 payment header from ${source} source is missing payload.authorization.`);
  }

  if (typeof auth.to !== "string" || auth.to.trim().length === 0) {
    throw new Error(`x402 payment header from ${source} source is missing payload.authorization.to.`);
  }

  const normalizedTo = auth.to.toLowerCase();
  if (normalizedTo !== X402_PAY_TO_ADDRESS) {
    throw new Error(
      `x402 payment "to" address mismatch: expected ${X402_PAY_TO_ADDRESS}, got ${normalizedTo}. Refusing to send payment to unknown address.`
    );
  }

  const normalizedValue = String(auth.value);
  if (normalizedValue !== X402_VALUE_MICRO_USDC) {
    throw new Error(
      `x402 payment value mismatch: expected ${X402_VALUE_MICRO_USDC}, got ${normalizedValue}. Refusing to send unexpected payment amount.`
    );
  }

  if (typeof auth.validBefore !== "string" && typeof auth.validBefore !== "number") {
    throw new Error(
      `x402 payment header from ${source} source is missing payload.authorization.validBefore.`
    );
  }

  const validBefore = Number(auth.validBefore);
  if (!Number.isFinite(validBefore)) {
    throw new Error(
      `x402 payment header from ${source} source has invalid payload.authorization.validBefore (${String(auth.validBefore)}).`
    );
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (validBefore <= nowSeconds) {
    throw new Error(`x402 payment header from ${source} source has expired (validBefore=${validBefore}).`);
  }
}

export async function requestX402PaymentHeader(params: {
  deps: Pick<CliDeps, "fetch" | "fs" | "homedir">;
  expectedAgentKey: string;
  payer: ResolvedPostPayer;
}): Promise<X402PaymentHeader> {
  const result =
    params.payer.mode === "local"
      ? await buildLocalX402PaymentHeader({
          expectedAgentKey: params.expectedAgentKey,
          payerAddress: params.payer.payerAddress,
          privateKeyHex: params.payer.privateKeyHex,
        })
      : await requestHostedX402PaymentHeader({
          deps: params.deps,
          expectedAgentKey: params.expectedAgentKey,
          fallbackPayerAddress: params.payer.payerAddress,
        });

  validateX402PaymentPayload(result.xPayment, params.payer.mode);

  return result;
}
