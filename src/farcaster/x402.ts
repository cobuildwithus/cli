import {
  X402_TRANSFER_PRIMARY_TYPE,
  buildX402AuthorizationPayload,
  buildX402PaymentPayload,
  buildX402TypedDataDomain,
  buildX402TypedDataTypes,
  validateFarcasterHostedX402PaymentResponse,
  decodeAndValidateX402PaymentPayload,
  encodeX402PaymentPayload,
} from "@cobuild/wire";
import { privateKeyToAccount } from "viem/accounts";
import { apiPost } from "../transport.js";
import type { CliDeps } from "../types.js";
import {
  BASE_CHAIN_ID,
  USDC_EIP712_DOMAIN_NAME,
  USDC_EIP712_DOMAIN_VERSION,
  X402_AUTH_TTL_SECONDS,
  X402_NETWORK,
  X402_PAY_TO_ADDRESS,
  X402_USDC_CONTRACT,
  X402_VALUE_MICRO_USDC,
} from "./constants.js";
import type {
  HexString,
  ResolvedPostPayer,
  X402PaymentHeader,
} from "./types.js";

const X402_TYPED_DATA_DOMAIN = buildX402TypedDataDomain({
  name: USDC_EIP712_DOMAIN_NAME,
  version: USDC_EIP712_DOMAIN_VERSION,
  chainId: BASE_CHAIN_ID,
  verifyingContract: X402_USDC_CONTRACT,
});

const X402_TYPED_DATA_TYPES = buildX402TypedDataTypes();

async function buildLocalX402PaymentHeader(params: {
  expectedAgentKey: string;
  payerAddress: string;
  privateKeyHex: HexString;
}): Promise<X402PaymentHeader> {
  const account = privateKeyToAccount(params.privateKeyHex);
  if (params.payerAddress.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error("Local wallet config mismatch: walletAddress does not match private key.");
  }
  const validBefore = Math.floor(Date.now() / 1000) + X402_AUTH_TTL_SECONDS;
  const authorization = buildX402AuthorizationPayload({
    from: account.address,
    validBefore,
  });

  const signature = await account.signTypedData({
    domain: X402_TYPED_DATA_DOMAIN,
    types: {
      TransferWithAuthorization: X402_TYPED_DATA_TYPES.TransferWithAuthorization,
    },
    primaryType: X402_TRANSFER_PRIMARY_TYPE,
    message: {
      from: authorization.from,
      to: authorization.to,
      value: BigInt(authorization.value),
      validAfter: BigInt(authorization.validAfter),
      validBefore: BigInt(authorization.validBefore),
      nonce: authorization.nonce,
    },
  });

  const xPaymentPayload = buildX402PaymentPayload({
    signature,
    authorization,
  });
  const xPayment = encodeX402PaymentPayload(xPaymentPayload);

  return {
    xPayment,
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
  const response = validateFarcasterHostedX402PaymentResponse(
    await apiPost(params.deps, "/api/cli/farcaster/x402-payment", {})
  );
  if (response.result.agentKey !== params.expectedAgentKey) {
    throw new Error(
      `Configured agent (${params.expectedAgentKey}) does not match authenticated token agent (${response.result.agentKey}). Update CLI config or use a token for the same agent.`
    );
  }

  return {
    xPayment: response.result.xPayment,
    payerAddress: response.result.payerAddress ?? params.fallbackPayerAddress,
    payerAgentKey: response.result.agentKey,
    x402Token: response.result.token,
    x402Amount: response.result.amount,
    x402Network: response.result.network,
  };
}

function remapWireX402ValidationError(message: string, source: "local" | "hosted"): string {
  if (message === "x402 payment header is not valid base64 JSON") {
    return `x402 payment header from ${source} source is not valid base64 JSON.`;
  }
  if (message === "x402 payment payload must be a JSON object") {
    return `x402 payment header from ${source} source is not a JSON object.`;
  }
  if (message === "x402 payment payload is missing payload.authorization") {
    return `x402 payment header from ${source} source is missing payload.authorization.`;
  }
  if (message === "x402 payment header is missing payload.authorization.to") {
    return `x402 payment header from ${source} source is missing payload.authorization.to.`;
  }
  if (message.startsWith('x402 payment "to" address mismatch:')) {
    return `${message} Refusing to send payment to unknown address.`;
  }
  if (message.startsWith("x402 payment value mismatch:")) {
    return `${message} Refusing to send unexpected payment amount.`;
  }
  if (message === "x402 payment header is missing payload.authorization.validBefore") {
    return `x402 payment header from ${source} source is missing payload.authorization.validBefore.`;
  }
  if (message.startsWith("x402 payment header has invalid payload.authorization.validBefore")) {
    return message.replace(
      "x402 payment header has invalid payload.authorization.validBefore",
      `x402 payment header from ${source} source has invalid payload.authorization.validBefore`
    );
  }
  if (message.startsWith("x402 payment header has expired")) {
    const withSource = message.replace(
      "x402 payment header has expired",
      `x402 payment header from ${source} source has expired`
    );
    return withSource.endsWith(".") ? withSource : `${withSource}.`;
  }

  return message;
}

function validateX402PaymentPayload(xPaymentBase64: string, source: "local" | "hosted"): void {
  try {
    decodeAndValidateX402PaymentPayload(xPaymentBase64, {
      requiredNetwork: X402_NETWORK,
      requiredPayTo: X402_PAY_TO_ADDRESS,
      requiredValue: X402_VALUE_MICRO_USDC,
      requireUnexpired: true,
      nowSeconds: Math.floor(Date.now() / 1000),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(remapWireX402ValidationError(message, source));
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
