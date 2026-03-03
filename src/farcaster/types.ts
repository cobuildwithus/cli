import type { SecretRef } from "../types.js";

export type X402VerifyMode = "none" | "once" | "poll";
export type X402PayerMode = "hosted" | "local";
export type X402InitMode = "hosted" | "local-generate" | "local-key";

export type HexString = `0x${string}`;

export type FarcasterReplyTarget = {
  parentAuthorFid: number;
  parentHashHex: HexString;
};

export type StoredFarcasterSigner = {
  publicKey: HexString;
  privateKeyHex: HexString;
  fid: number | null;
  signerRef?: SecretRef;
};

export type FarcasterPostVerifyResult = {
  enabled: true;
  included: true;
  attempts: number;
};

export type FarcasterPostReceiptResult = {
  hubResponseStatus: number;
  hubResponseText: string;
  payerAddress?: string | null;
  payerAgentKey?: string;
  x402Token?: string | null;
  x402Amount?: string | null;
  x402Network?: string | null;
  verification?: FarcasterPostVerifyResult;
};

export type FarcasterPostReceipt = {
  version: number;
  idempotencyKey: string;
  state: "pending" | "succeeded";
  request: {
    fid: number;
    text: string;
    verify: boolean;
    verifyMode?: "once" | "poll";
    replyTo?: FarcasterReplyTarget;
  };
  castHashHex: HexString;
  messageBytesBase64: string;
  result?: FarcasterPostReceiptResult;
  savedAt: string;
};

export type LegacyFarcasterPostReceipt = {
  version: number;
  idempotencyKey: string;
  request: {
    fid: number;
    text: string;
  };
  result: {
    castHashHex: HexString;
    hubResponseStatus: number;
    hubResponseText: string;
    payerAddress?: string | null;
    payerAgentKey?: string;
    x402Token?: string | null;
    x402Amount?: string | null;
    x402Network?: string | null;
  };
  savedAt: string;
};

export type X402PaymentHeader = {
  xPayment: string;
  payerAddress: string | null;
  payerAgentKey: string;
  x402Token: string | null;
  x402Amount: string | null;
  x402Network: string | null;
};

export type StoredX402PayerConfig = {
  version: 1;
  mode: X402PayerMode;
  payerAddress: string | null;
  payerRef?: SecretRef;
  network: "base";
  token: "usdc";
  createdAt: string;
};

export type X402PayerSetupResult = {
  mode: X402PayerMode;
  payerAddress: string | null;
};

export type ResolvedPostPayer =
  | {
      mode: "hosted";
      payerAddress: string | null;
    }
  | {
      mode: "local";
      payerAddress: string;
      privateKeyHex: HexString;
    };
