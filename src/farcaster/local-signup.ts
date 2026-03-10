import {
  FARCASTER_CONTRACTS,
  FARCASTER_ID_GATEWAY_ABI,
  FARCASTER_ID_REGISTRY_ABI,
  buildFarcasterSignupCompletedResult,
  buildFarcasterSignupNeedsFundingResult,
  buildFarcasterSignedKeyRequestMetadata,
  buildFarcasterSignedKeyRequestTypedData,
  buildFarcasterSignupCallPlan,
  buildFarcasterSignupExecutableCalls,
  computeFarcasterSignedKeyRequestDeadline,
  evaluateFarcasterSignupPreflight,
  type FarcasterSignupResult,
} from "@cobuild/wire";
import { createPublicClient, createWalletClient, http } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { optimism } from "viem/chains";
import { normalizeEvmAddress } from "../commands/shared.js";
import type { CliDeps } from "../types.js";
import type { HexString } from "./types.js";

const DEFAULT_OPTIMISM_RPC_URL = "https://mainnet.optimism.io";
const FARCASTER_LOCAL_TX_TIMEOUT_MS = 120_000;

export class LocalFarcasterAlreadyRegisteredError extends Error {
  readonly fid: string;
  readonly custodyAddress: `0x${string}`;

  constructor(params: { fid: bigint; custodyAddress: `0x${string}` }) {
    super(`Farcaster account already exists for this agent wallet (fid: ${params.fid.toString()}).`);
    this.fid = params.fid.toString();
    this.custodyAddress = params.custodyAddress;
  }
}

function resolveOptimismRpcUrl(deps: Pick<CliDeps, "env">): string {
  const env = deps.env ?? process.env;
  const configured = env.COBUILD_CLI_OPTIMISM_RPC_URL?.trim();
  if (configured) {
    return configured;
  }
  const chainDefault = optimism.rpcUrls.default.http[0];
  if (typeof chainDefault === "string" && chainDefault.trim().length > 0) {
    return chainDefault;
  }
  return DEFAULT_OPTIMISM_RPC_URL;
}

async function sendAndWaitTx(params: {
  walletClient: Pick<ReturnType<typeof createWalletClient>, "sendTransaction">;
  publicClient: Pick<ReturnType<typeof createPublicClient>, "waitForTransactionReceipt">;
  account: ReturnType<typeof privateKeyToAccount>;
  to: `0x${string}`;
  value: bigint;
  data: `0x${string}`;
}): Promise<`0x${string}`> {
  const txHash = await params.walletClient.sendTransaction({
    account: params.account,
    chain: optimism,
    to: params.to,
    value: params.value,
    data: params.data,
  });

  const receipt = await params.publicClient.waitForTransactionReceipt({
    hash: txHash,
    confirmations: 1,
    timeout: FARCASTER_LOCAL_TX_TIMEOUT_MS,
  });
  if (receipt.status !== "success") {
    throw new Error(`Local Farcaster signup transaction reverted (tx: ${txHash}).`);
  }
  return txHash;
}

export async function executeLocalFarcasterSignup(params: {
  deps: Pick<CliDeps, "env">;
  privateKeyHex: HexString;
  signerPublicKey: `0x${string}`;
  recoveryAddress?: string;
  extraStorage?: string;
}): Promise<FarcasterSignupResult> {
  const rpcUrl = resolveOptimismRpcUrl(params.deps);
  const transport = http(rpcUrl, {
    timeout: 30_000,
    retryCount: 2,
  });

  const account = privateKeyToAccount(params.privateKeyHex);
  const ownerAddress = account.address;
  const custodyAddress = ownerAddress;
  const recoveryAddress = normalizeEvmAddress(params.recoveryAddress ?? ownerAddress, "--recovery");
  const extraStorage = params.extraStorage ? BigInt(params.extraStorage) : 0n;

  const publicClient = createPublicClient({
    chain: optimism,
    transport,
  });
  const walletClient = createWalletClient({
    account,
    chain: optimism,
    transport,
  });

  const existingFid = await publicClient.readContract({
    address: FARCASTER_CONTRACTS.idRegistry,
    abi: FARCASTER_ID_REGISTRY_ABI,
    functionName: "idOf",
    args: [custodyAddress],
  });
  if (existingFid > 0n) {
    throw new LocalFarcasterAlreadyRegisteredError({
      fid: existingFid,
      custodyAddress,
    });
  }

  const priceWei = await publicClient.readContract({
    address: FARCASTER_CONTRACTS.idGateway,
    abi: FARCASTER_ID_GATEWAY_ABI,
    functionName: "price",
    args: [extraStorage],
  });
  const balanceWei = await publicClient.getBalance({
    address: custodyAddress,
  });

  const preflight = evaluateFarcasterSignupPreflight({
    custodyAddress,
    existingFid,
    idGatewayPriceWei: priceWei,
    balanceWei,
  });
  if (preflight.status === "needs_funding") {
    return buildFarcasterSignupNeedsFundingResult({
      ownerAddress,
      custodyAddress,
      recoveryAddress,
      idGatewayPriceWei: priceWei,
      balanceWei,
      requiredWei: preflight.requiredWei,
    });
  }

  const deadline = computeFarcasterSignedKeyRequestDeadline();
  const requestSigner = privateKeyToAccount(generatePrivateKey());
  const typedData = buildFarcasterSignedKeyRequestTypedData({
    requestFid: 0n,
    signerPublicKey: params.signerPublicKey,
    deadline,
  });
  const signedKeyRequestSignature = await requestSigner.signTypedData({
    domain: typedData.domain,
    types: { SignedKeyRequest: typedData.types.SignedKeyRequest },
    primaryType: typedData.primaryType,
    message: typedData.message,
  });
  const signedKeyRequestMetadata = buildFarcasterSignedKeyRequestMetadata({
    requestFid: typedData.message.requestFid,
    requestSigner: requestSigner.address,
    signature: signedKeyRequestSignature,
    deadline: typedData.message.deadline,
  });

  const signupCallPlan = buildFarcasterSignupCallPlan({
    recoveryAddress,
    extraStorage,
    idGatewayPriceWei: priceWei,
    signerPublicKey: params.signerPublicKey,
    signedKeyRequestMetadata,
  });
  const [registerCall, addKeyCall] = buildFarcasterSignupExecutableCalls(signupCallPlan);

  await sendAndWaitTx({
    walletClient,
    publicClient,
    account,
    to: registerCall.to,
    value: registerCall.value,
    data: registerCall.data,
  });
  const txHash = await sendAndWaitTx({
    walletClient,
    publicClient,
    account,
    to: addKeyCall.to,
    value: addKeyCall.value,
    data: addKeyCall.data,
  });

  const assignedFid = await publicClient.readContract({
    address: FARCASTER_CONTRACTS.idRegistry,
    abi: FARCASTER_ID_REGISTRY_ABI,
    functionName: "idOf",
    args: [custodyAddress],
  });
  if (assignedFid === 0n) {
    throw new Error("Farcaster signup confirmed but FID was not assigned to custody address.");
  }

  return buildFarcasterSignupCompletedResult({
    ownerAddress,
    custodyAddress,
    recoveryAddress,
    fid: assignedFid,
    idGatewayPriceWei: priceWei,
    txHash,
  });
}
