import path from "node:path";
import { asRecord } from "../transport.js";
import type { CliDeps } from "../types.js";
import {
  FARCASTER_CAST_HASH_HEX_PATTERN,
  POST_RECEIPT_VERSION,
} from "./constants.js";
import type {
  FarcasterPostReceipt,
  FarcasterPostReceiptResult,
  FarcasterPostVerifyResult,
  FarcasterReplyTarget,
  HexString,
  LegacyFarcasterPostReceipt,
  X402VerifyMode,
} from "./types.js";

function isHexLike(value: unknown): value is HexString {
  return typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value);
}

function isFarcasterReplyTarget(value: unknown): value is FarcasterReplyTarget {
  const record = asRecord(value);
  return (
    typeof record.parentAuthorFid === "number" &&
    Number.isSafeInteger(record.parentAuthorFid) &&
    record.parentAuthorFid > 0 &&
    typeof record.parentHashHex === "string" &&
    FARCASTER_CAST_HASH_HEX_PATTERN.test(record.parentHashHex)
  );
}

function isFarcasterPostVerifyResult(value: unknown): value is FarcasterPostVerifyResult {
  const record = asRecord(value);
  return (
    record.enabled === true &&
    record.included === true &&
    typeof record.attempts === "number" &&
    Number.isSafeInteger(record.attempts) &&
    record.attempts > 0
  );
}

function isFarcasterPostReceiptResult(value: unknown): value is FarcasterPostReceiptResult {
  const record = asRecord(value);
  const verification = record.verification;
  const verificationValid =
    verification === undefined || verification === null || isFarcasterPostVerifyResult(verification);
  return (
    typeof record.hubResponseStatus === "number" &&
    Number.isSafeInteger(record.hubResponseStatus) &&
    typeof record.hubResponseText === "string" &&
    verificationValid
  );
}

function isCurrentFarcasterPostReceipt(value: unknown): value is FarcasterPostReceipt {
  const record = asRecord(value);
  const request = asRecord(record.request);
  const state = record.state;
  if (state !== "pending" && state !== "succeeded") {
    return false;
  }
  const resultValid =
    record.result === undefined ||
    record.result === null ||
    isFarcasterPostReceiptResult(record.result);

  if (!resultValid) {
    return false;
  }

  if (state === "pending" && record.result !== undefined && record.result !== null) {
    return false;
  }
  if (state === "succeeded" && (record.result === undefined || record.result === null)) {
    return false;
  }

  return (
    record.version === POST_RECEIPT_VERSION &&
    typeof record.idempotencyKey === "string" &&
    state !== undefined &&
    typeof request.fid === "number" &&
    typeof request.text === "string" &&
    typeof request.verify === "boolean" &&
    (request.verifyMode === undefined ||
      request.verifyMode === "once" ||
      request.verifyMode === "poll") &&
    (request.replyTo === undefined || isFarcasterReplyTarget(request.replyTo)) &&
    isHexLike(record.castHashHex) &&
    typeof record.messageBytesBase64 === "string" &&
    typeof record.savedAt === "string"
  );
}

function isLegacyFarcasterPostReceipt(value: unknown): value is LegacyFarcasterPostReceipt {
  const record = asRecord(value);
  const request = asRecord(record.request);
  const result = asRecord(record.result);
  return (
    record.version === POST_RECEIPT_VERSION &&
    typeof record.idempotencyKey === "string" &&
    typeof request.fid === "number" &&
    typeof request.text === "string" &&
    isHexLike(result.castHashHex) &&
    typeof result.hubResponseStatus === "number" &&
    Number.isSafeInteger(result.hubResponseStatus) &&
    typeof result.hubResponseText === "string" &&
    typeof record.savedAt === "string"
  );
}

function normalizeLegacyFarcasterPostReceipt(receipt: LegacyFarcasterPostReceipt): FarcasterPostReceipt {
  return {
    version: receipt.version,
    idempotencyKey: receipt.idempotencyKey,
    state: "succeeded",
    request: {
      fid: receipt.request.fid,
      text: receipt.request.text,
      verify: false,
    },
    castHashHex: receipt.result.castHashHex,
    messageBytesBase64: "",
    result: {
      hubResponseStatus: receipt.result.hubResponseStatus,
      hubResponseText: receipt.result.hubResponseText,
      payerAddress:
        typeof receipt.result.payerAddress === "string" ? receipt.result.payerAddress : null,
      payerAgentKey:
        typeof receipt.result.payerAgentKey === "string" ? receipt.result.payerAgentKey : undefined,
      x402Token: typeof receipt.result.x402Token === "string" ? receipt.result.x402Token : null,
      x402Amount: typeof receipt.result.x402Amount === "string" ? receipt.result.x402Amount : null,
      x402Network: typeof receipt.result.x402Network === "string" ? receipt.result.x402Network : null,
    },
    savedAt: receipt.savedAt,
  };
}

export function encodeMessageBytesBase64(messageBytes: Uint8Array): string {
  return Buffer.from(messageBytes).toString("base64");
}

export function decodeMessageBytesBase64(base64Value: string): Uint8Array {
  if (!base64Value || base64Value.trim().length === 0) {
    throw new Error("Farcaster post receipt is missing message bytes for pending replay.");
  }
  try {
    const decoded = Buffer.from(base64Value, "base64");
    if (decoded.length === 0) {
      /* v8 ignore next */
      throw new Error("empty");
    }
    return new Uint8Array(decoded);
  } catch {
    throw new Error(
      "Farcaster post receipt has invalid message bytes. Delete the receipt and retry with a new idempotency key."
    );
  }
}

export function resolvePostReceiptPath(params: {
  deps: Pick<CliDeps, "homedir">;
  agentKey: string;
  idempotencyKey: string;
}): string {
  return path.join(
    params.deps.homedir(),
    ".cobuild-cli",
    "agents",
    params.agentKey,
    "farcaster",
    "posts",
    `${params.idempotencyKey}.json`
  );
}

export function readPostReceipt(params: {
  deps: Pick<CliDeps, "fs">;
  receiptPath: string;
}): FarcasterPostReceipt | null {
  if (!params.deps.fs.existsSync(params.receiptPath)) {
    return null;
  }

  let raw: string;
  try {
    raw = params.deps.fs.readFileSync(params.receiptPath, "utf8");
  } catch {
    throw new Error("Failed to read Farcaster post idempotency receipt.");
  }

  try {
    const parsed = JSON.parse(raw);
    if (isCurrentFarcasterPostReceipt(parsed)) {
      return parsed;
    }
    if (isLegacyFarcasterPostReceipt(parsed)) {
      return normalizeLegacyFarcasterPostReceipt(parsed);
    }
    throw new Error("invalid-shape");
  } catch {
    throw new Error(
      "Farcaster post idempotency receipt is invalid. Delete the receipt and retry with a new idempotency key."
    );
  }
}

export function assertPostReceiptMatch(params: {
  receipt: FarcasterPostReceipt;
  idempotencyKey: string;
  fid: number;
  text: string;
  verify: boolean;
  verifyMode: X402VerifyMode;
  replyTo?: FarcasterReplyTarget;
}): void {
  const receiptVerify = params.receipt.request.verify ?? false;
  const receiptVerifyMode = params.receipt.request.verifyMode ?? (receiptVerify ? "once" : "none");
  const expectedReplyTo = params.replyTo ?? null;
  const receiptReplyTo = params.receipt.request.replyTo ?? null;
  if (
    params.receipt.idempotencyKey !== params.idempotencyKey ||
    params.receipt.request.fid !== params.fid ||
    params.receipt.request.text !== params.text ||
    receiptVerify !== params.verify ||
    receiptVerifyMode !== params.verifyMode ||
    JSON.stringify(receiptReplyTo) !== JSON.stringify(expectedReplyTo)
  ) {
    throw new Error(
      "Idempotency key was already used for a different Farcaster post request."
    );
  }
}

export function writePostReceipt(params: {
  deps: Pick<CliDeps, "fs">;
  receiptPath: string;
  receipt: FarcasterPostReceipt;
}): void {
  const receiptDir = path.dirname(params.receiptPath);
  params.deps.fs.mkdirSync(receiptDir, { recursive: true, mode: 0o700 });
  const serialized = JSON.stringify(params.receipt, null, 2);
  const renameSync = params.deps.fs.renameSync;
  const unlinkSync = params.deps.fs.unlinkSync;

  if (!renameSync) {
    params.deps.fs.writeFileSync(params.receiptPath, serialized, {
      encoding: "utf8",
      mode: 0o600,
    });
    params.deps.fs.chmodSync?.(params.receiptPath, 0o600);
    return;
  }

  const tempPath = `${params.receiptPath}.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  params.deps.fs.writeFileSync(tempPath, serialized, {
    encoding: "utf8",
    mode: 0o600,
  });
  params.deps.fs.chmodSync?.(tempPath, 0o600);
  try {
    renameSync(tempPath, params.receiptPath);
  } catch (error) {
    /* v8 ignore start */
    try {
      unlinkSync?.(tempPath);
    } catch {
      // ignore cleanup failures; original write error is the root cause.
    }
    /* v8 ignore stop */
    throw error;
  }
  params.deps.fs.chmodSync?.(params.receiptPath, 0o600);
}

function parseHubResponseBody(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    /* v8 ignore next */
    return "";
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

export function buildPostResultPayload(params: {
  fid: number;
  text: string;
  castHashHex: HexString;
  result: FarcasterPostReceiptResult;
  fallbackAgentKey: string;
  replyTo?: FarcasterReplyTarget;
}): Record<string, unknown> {
  return {
    fid: params.fid,
    text: params.text,
    ...(params.replyTo
      ? {
          parentAuthorFid: params.replyTo.parentAuthorFid,
          parentHashHex: params.replyTo.parentHashHex,
        }
      : {}),
    castHashHex: params.castHashHex,
    hubResponseStatus: params.result.hubResponseStatus,
    hubResponse: parseHubResponseBody(params.result.hubResponseText),
    payerAddress: typeof params.result.payerAddress === "string" ? params.result.payerAddress : null,
    payerAgentKey:
      typeof params.result.payerAgentKey === "string"
        ? params.result.payerAgentKey
        : params.fallbackAgentKey,
    x402Token: typeof params.result.x402Token === "string" ? params.result.x402Token : null,
    x402Amount: typeof params.result.x402Amount === "string" ? params.result.x402Amount : null,
    x402Network: typeof params.result.x402Network === "string" ? params.result.x402Network : null,
    ...(params.result.verification ? { verification: params.result.verification } : {}),
  };
}
