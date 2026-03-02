import path from "node:path";
import { parseArgs } from "node:util";
import * as ed from "@noble/ed25519";
import {
  CastType,
  FarcasterNetwork,
  Message,
  NobleEd25519Signer,
  makeCastAdd,
} from "@farcaster/hub-nodejs";
import { bytesToHex, hexToBytes } from "viem";
import { readConfig } from "../config.js";
import { printJson } from "../output.js";
import { ApiRequestError, asRecord, apiPost } from "../transport.js";
import type { CliConfig, CliDeps, SecretRef } from "../types.js";
import { buildFarcasterSignerRef, isSecretRef } from "../secrets/ref-contract.js";
import { resolveSecretRefString, setSecretRefString, withDefaultSecretProviders } from "../secrets/runtime.js";
import {
  buildIdempotencyHeaders,
  resolveAgentKey,
  resolveExecIdempotencyKey,
  throwWithIdempotencyKey,
  validateEvmAddress,
} from "./shared.js";

const FARCASTER_USAGE = `Usage:
  cli farcaster signup [--agent <key>] [--recovery <0x...>] [--extra-storage <n>] [--out-dir <path>]
  cli farcaster post --text <text> [--fid <n>] [--signer-file <path>] [--idempotency-key <key>] [--verify]`;
const SIGNER_FILE_NAME = "ed25519-signer.json";
const NEYNAR_HUB_SUBMIT_URL = "https://hub-api.neynar.com/v1/submitMessage";
const NEYNAR_HUB_CAST_BY_ID_URL = "https://hub-api.neynar.com/v1/castById";
const HUB_PAYMENT_RETRYABLE_STATUS = 402;
const HUB_SUBMIT_MAX_ATTEMPTS = 2;
const HUB_SUBMIT_TIMEOUT_MS = 30_000;
const HUB_VERIFY_TIMEOUT_MS = 10_000;
const VERIFY_POLL_ATTEMPTS = 5;
const VERIFY_POLL_INTERVAL_MS = 1_200;
const FARCASTER_MAX_CAST_TEXT_BYTES = 320;
const POST_RECEIPT_VERSION = 1;

type HexString = `0x${string}`;

type StoredFarcasterSigner = {
  publicKey: HexString;
  privateKeyHex: HexString;
  fid: number | null;
  signerRef?: SecretRef;
};

type FarcasterPostVerifyResult = {
  enabled: true;
  included: true;
  attempts: number;
};

type FarcasterPostReceiptResult = {
  hubResponseStatus: number;
  hubResponseText: string;
  payerAddress?: string | null;
  payerAgentKey?: string;
  x402Token?: string | null;
  x402Amount?: string | null;
  x402Network?: string | null;
  verification?: FarcasterPostVerifyResult;
};

type FarcasterPostReceipt = {
  version: number;
  idempotencyKey: string;
  state: "pending" | "succeeded";
  request: {
    fid: number;
    text: string;
    verify: boolean;
  };
  castHashHex: HexString;
  messageBytesBase64: string;
  result?: FarcasterPostReceiptResult;
  savedAt: string;
};

type LegacyFarcasterPostReceipt = {
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

type X402PaymentHeader = {
  xPayment: string;
  payerAddress: string | null;
  payerAgentKey: string;
  x402Token: string | null;
  x402Amount: string | null;
  x402Network: string | null;
};

function normalizeTextOption(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("--text cannot be empty");
  }
  if (Buffer.byteLength(trimmed, "utf8") > FARCASTER_MAX_CAST_TEXT_BYTES) {
    throw new Error(`--text must be at most ${FARCASTER_MAX_CAST_TEXT_BYTES} bytes`);
  }
  return trimmed;
}

function normalizeSignupArgs(args: string[]): string[] {
  const normalized: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    const next = args[index + 1];
    if (current === "--extra-storage" && typeof next === "string" && /^-\d+$/.test(next)) {
      normalized.push(`--extra-storage=${next}`);
      index += 1;
      continue;
    }
    normalized.push(current);
  }
  return normalized;
}

function normalizeDirectoryOption(value: string | undefined, optionName: string): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${optionName} cannot be empty`);
  return trimmed;
}

function normalizeSignerFileOption(value: string | undefined): string | undefined {
  return normalizeDirectoryOption(value, "--signer-file");
}

function parseExtraStorage(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error("--extra-storage must be a non-negative integer");
  }
  return trimmed;
}

function resolveSignerOutputDirectory(params: {
  deps: Pick<CliDeps, "homedir">;
  agentKey: string;
  outDir: string | undefined;
}): string {
  if (params.outDir) {
    return params.outDir;
  }

  return path.join(
    params.deps.homedir(),
    ".cobuild-cli",
    "agents",
    params.agentKey,
    "farcaster"
  );
}

function resolveSignerFilePath(params: {
  deps: Pick<CliDeps, "homedir">;
  agentKey: string;
  signerFile: string | undefined;
}): string {
  if (params.signerFile) {
    return params.signerFile;
  }

  const signerDirectory = resolveSignerOutputDirectory({
    deps: params.deps,
    agentKey: params.agentKey,
    outDir: undefined,
  });
  return path.join(signerDirectory, SIGNER_FILE_NAME);
}

function generateEd25519PrivateKey(): Uint8Array {
  return ed.utils.randomPrivateKey();
}

function saveSignerSecret(params: {
  deps: Pick<CliDeps, "fs" | "homedir">;
  config: CliConfig;
  agentKey: string;
  outputDirectory: string;
  signerPublicKey: `0x${string}`;
  signerPrivateKey: Uint8Array;
  result: Record<string, unknown>;
}): void {
  const configWithSecrets = withDefaultSecretProviders(params.config, params.deps);
  const signerRef = buildFarcasterSignerRef(configWithSecrets, params.agentKey);
  const privateKeyHex = bytesToHex(params.signerPrivateKey) as HexString;
  setSecretRefString({
    deps: params.deps,
    config: configWithSecrets,
    ref: signerRef,
    value: privateKeyHex,
  });

  params.deps.fs.mkdirSync(params.outputDirectory, { recursive: true, mode: 0o700 });

  const secretPath = path.join(params.outputDirectory, SIGNER_FILE_NAME);
  const fid = typeof params.result.fid === "string" ? params.result.fid : null;
  const custodyAddress =
    typeof params.result.custodyAddress === "string" ? params.result.custodyAddress : null;
  const payload = {
    version: 2,
    algorithm: "ed25519",
    publicKey: params.signerPublicKey,
    signerRef,
    fid,
    custodyAddress,
    network: "optimism",
    createdAt: new Date().toISOString(),
  };

  params.deps.fs.writeFileSync(secretPath, JSON.stringify(payload, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  params.deps.fs.chmodSync?.(secretPath, 0o600);
}

function withSignerInfo(payload: Record<string, unknown>, signerPublicKey: `0x${string}`, saved: boolean) {
  return {
    ...payload,
    signer: {
      publicKey: signerPublicKey,
      saved,
      file: SIGNER_FILE_NAME,
    },
  };
}

function parseFidString(value: string | undefined, optionName: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`${optionName} must be a positive integer`);
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${optionName} must be a positive integer`);
  }
  return parsed;
}

function parseOptionalFid(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return value;
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function isHex32BytePrivateKey(value: unknown): value is HexString {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

function isHex32BytePublicKey(value: unknown): value is HexString {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

function readStoredSigner(params: {
  deps: Pick<CliDeps, "fs" | "homedir" | "env">;
  config: CliConfig;
  agentKey: string;
  signerFilePath: string;
}): StoredFarcasterSigner {
  let raw: string;
  try {
    raw = params.deps.fs.readFileSync(params.signerFilePath, "utf8");
  } catch {
    throw new Error(
      "Could not read Farcaster signer file. Run `cli farcaster signup` or pass --signer-file."
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Farcaster signer file contains invalid JSON.");
  }

  const record = asRecord(parsed);
  if (!isHex32BytePublicKey(record.publicKey)) {
    throw new Error("Farcaster signer file is missing a valid publicKey.");
  }

  const configWithProviders = withDefaultSecretProviders(params.config, params.deps);

  if (isSecretRef(record.signerRef)) {
    const privateKeyHex = resolveSecretRefString({
      deps: params.deps,
      config: configWithProviders,
      ref: record.signerRef,
    });
    if (!isHex32BytePrivateKey(privateKeyHex)) {
      throw new Error("Farcaster signer secret ref did not resolve to a valid private key.");
    }
    return {
      publicKey: record.publicKey,
      privateKeyHex,
      fid: parseOptionalFid(record.fid),
      signerRef: record.signerRef,
    };
  }

  if (!isHex32BytePrivateKey(record.privateKeyHex)) {
    throw new Error("Farcaster signer file is missing a valid signerRef/privateKeyHex.");
  }

  // Legacy migration: move plaintext private key from signer file into secret store.
  const signerRef = buildFarcasterSignerRef(configWithProviders, params.agentKey);
  setSecretRefString({
    deps: params.deps,
    config: configWithProviders,
    ref: signerRef,
    value: record.privateKeyHex,
  });

  const migratedPayload = {
    version: 2,
    algorithm: "ed25519",
    publicKey: record.publicKey,
    signerRef,
    fid: typeof record.fid === "string" || typeof record.fid === "number" ? record.fid : null,
    custodyAddress: typeof record.custodyAddress === "string" ? record.custodyAddress : null,
    network: typeof record.network === "string" ? record.network : "optimism",
    createdAt: typeof record.createdAt === "string" ? record.createdAt : new Date().toISOString(),
  };
  params.deps.fs.writeFileSync(params.signerFilePath, JSON.stringify(migratedPayload, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  params.deps.fs.chmodSync?.(params.signerFilePath, 0o600);

  return {
    publicKey: record.publicKey,
    privateKeyHex: record.privateKeyHex,
    fid: parseOptionalFid(record.fid),
    signerRef,
  };
}

function resolvePostFid(params: {
  inputFid: string | undefined;
  signerFid: number | null;
}): number {
  const explicit = parseFidString(params.inputFid, "--fid");
  if (explicit !== undefined) {
    return explicit;
  }
  if (params.signerFid !== null) {
    return params.signerFid;
  }
  throw new Error("Farcaster FID missing. Pass --fid or run `cli farcaster signup` to refresh signer metadata.");
}

function resolvePostReceiptPath(params: {
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

function isHexLike(value: unknown): value is HexString {
  return typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value);
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

function encodeMessageBytesBase64(messageBytes: Uint8Array): string {
  return Buffer.from(messageBytes).toString("base64");
}

function decodeMessageBytesBase64(base64Value: string): Uint8Array {
  if (!base64Value || base64Value.trim().length === 0) {
    throw new Error("Farcaster post receipt is missing message bytes for pending replay.");
  }
  try {
    const decoded = Buffer.from(base64Value, "base64");
    if (decoded.length === 0) {
      throw new Error("empty");
    }
    return new Uint8Array(decoded);
  } catch {
    throw new Error(
      "Farcaster post receipt has invalid message bytes. Delete the receipt and retry with a new idempotency key."
    );
  }
}

function readPostReceipt(params: {
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

function assertPostReceiptMatch(params: {
  receipt: FarcasterPostReceipt;
  idempotencyKey: string;
  fid: number;
  text: string;
  verify: boolean;
}): void {
  const receiptVerify = params.receipt.request.verify ?? false;
  if (
    params.receipt.idempotencyKey !== params.idempotencyKey ||
    params.receipt.request.fid !== params.fid ||
    params.receipt.request.text !== params.text ||
    receiptVerify !== params.verify
  ) {
    throw new Error(
      "Idempotency key was already used for a different Farcaster post request."
    );
  }
}

function writePostReceipt(params: {
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
    try {
      unlinkSync?.(tempPath);
    } catch {
      // ignore cleanup failures; original write error is the root cause.
    }
    throw error;
  }
  params.deps.fs.chmodSync?.(params.receiptPath, 0o600);
}

function buildPostResultPayload(params: {
  fid: number;
  text: string;
  castHashHex: HexString;
  result: FarcasterPostReceiptResult;
  fallbackAgentKey: string;
}): Record<string, unknown> {
  return {
    fid: params.fid,
    text: params.text,
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

function parseHubResponseBody(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    return "";
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

function sanitizeHubErrorText(text: string): string {
  const sanitized = text.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim();
  if (!sanitized) {
    return "";
  }
  return sanitized.length > 240 ? `${sanitized.slice(0, 237)}...` : sanitized;
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { name?: unknown; code?: unknown };
  return value.name === "AbortError" || value.code === "ABORT_ERR";
}

async function waitForMs(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

async function fetchHubWithTimeout(params: {
  deps: Pick<CliDeps, "fetch">;
  url: string;
  init: NonNullable<Parameters<CliDeps["fetch"]>[1]>;
  timeoutMs: number;
  timeoutLabel: string;
}): Promise<Awaited<ReturnType<CliDeps["fetch"]>>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, params.timeoutMs);
  timeout.unref?.();

  try {
    return await params.deps.fetch(params.url, {
      ...params.init,
      signal: controller.signal,
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(`${params.timeoutLabel} timed out after ${params.timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function buildCastMessage(params: {
  fid: number;
  text: string;
  signerPrivateKeyHex: HexString;
}): Promise<{ messageBytes: Uint8Array; castHashHex: HexString }> {
  const signer = new NobleEd25519Signer(hexToBytes(params.signerPrivateKeyHex));
  const castResult = await makeCastAdd(
    {
      text: params.text,
      embeds: [],
      embedsDeprecated: [],
      mentions: [],
      mentionsPositions: [],
      type: CastType.CAST,
    },
    {
      fid: params.fid,
      network: FarcasterNetwork.MAINNET,
    },
    signer
  );

  if (castResult.isErr()) {
    throw new Error(`Failed to construct Farcaster cast message: ${castResult.error}`);
  }

  const message = castResult.value;
  return {
    messageBytes: Message.encode(message).finish(),
    castHashHex: (`0x${Buffer.from(message.hash).toString("hex")}` as HexString),
  };
}

async function requestX402PaymentHeader(params: {
  deps: Pick<CliDeps, "fetch" | "fs" | "homedir">;
  idempotencyKey: string;
  expectedAgentKey: string;
}): Promise<X402PaymentHeader> {
  const response = await apiPost(
    params.deps,
    "/api/buildbot/farcaster/x402-payment",
    {
      idempotencyKey: params.idempotencyKey,
    },
    {
      headers: buildIdempotencyHeaders(params.idempotencyKey),
    }
  );

  const payload = asRecord(response);
  const result = asRecord(payload.result);
  const xPayment =
    (typeof result.xPayment === "string" ? result.xPayment : null) ??
    (typeof payload.xPayment === "string" ? payload.xPayment : null);

  if (!xPayment) {
    throw new Error("Build-bot x402 payment response did not include xPayment.");
  }

  const payerAddress = typeof result.payerAddress === "string" ? result.payerAddress : null;
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

async function fetchCastById(params: {
  deps: Pick<CliDeps, "fetch" | "fs" | "homedir">;
  idempotencyKey: string;
  agentKey: string;
  fid: number;
  castHashHex: HexString;
}): Promise<{ status: number; body: string }> {
  const castByIdUrl = new URL(NEYNAR_HUB_CAST_BY_ID_URL);
  castByIdUrl.searchParams.set("fid", String(params.fid));
  castByIdUrl.searchParams.set("hash", params.castHashHex);

  const unauthenticated = await fetchHubWithTimeout({
    deps: params.deps,
    url: castByIdUrl.toString(),
    init: {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    },
    timeoutMs: HUB_VERIFY_TIMEOUT_MS,
    timeoutLabel: "Neynar hub cast verification request",
  });
  const unauthenticatedBody = await unauthenticated.text();
  if (unauthenticated.status !== HUB_PAYMENT_RETRYABLE_STATUS) {
    return {
      status: unauthenticated.status,
      body: unauthenticatedBody,
    };
  }

  const payment = await requestX402PaymentHeader({
    deps: params.deps,
    idempotencyKey: params.idempotencyKey,
    expectedAgentKey: params.agentKey,
  });
  const paidResponse = await fetchHubWithTimeout({
    deps: params.deps,
    url: castByIdUrl.toString(),
    init: {
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-PAYMENT": payment.xPayment,
      },
    },
    timeoutMs: HUB_VERIFY_TIMEOUT_MS,
    timeoutLabel: "Neynar hub cast verification request",
  });
  return {
    status: paidResponse.status,
    body: await paidResponse.text(),
  };
}

async function verifyCastInclusion(params: {
  deps: Pick<CliDeps, "fetch" | "fs" | "homedir">;
  idempotencyKey: string;
  agentKey: string;
  fid: number;
  castHashHex: HexString;
}): Promise<FarcasterPostVerifyResult> {
  for (let attempt = 1; attempt <= VERIFY_POLL_ATTEMPTS; attempt += 1) {
    const verification = await fetchCastById({
      deps: params.deps,
      idempotencyKey: params.idempotencyKey,
      agentKey: params.agentKey,
      fid: params.fid,
      castHashHex: params.castHashHex,
    });

    if (verification.status >= 200 && verification.status < 300) {
      return {
        enabled: true,
        included: true,
        attempts: attempt,
      };
    }

    if (verification.status === 404 && attempt < VERIFY_POLL_ATTEMPTS) {
      await waitForMs(VERIFY_POLL_INTERVAL_MS);
      continue;
    }

    if (verification.status === 404) {
      throw new Error(
        `Cast was not observed in Neynar hub reads after ${VERIFY_POLL_ATTEMPTS} attempts`
      );
    }

    const detail = sanitizeHubErrorText(verification.body);
    const suffix = detail ? `: ${detail}` : "";
    throw new Error(
      `Neynar hub cast verification failed (status ${verification.status})${suffix}`
    );
  }

  throw new Error("Neynar hub cast verification failed.");
}

async function submitCastToHub(params: {
  deps: Pick<CliDeps, "fetch" | "fs" | "homedir">;
  idempotencyKey: string;
  agentKey: string;
  messageBytes: Uint8Array;
}): Promise<{
  hubResponseStatus: number;
  hubResponseText: string;
  x402: Omit<X402PaymentHeader, "xPayment">;
}> {
  let x402Metadata: Omit<X402PaymentHeader, "xPayment"> | null = null;

  for (let attempt = 0; attempt < HUB_SUBMIT_MAX_ATTEMPTS; attempt += 1) {
    const payment = await requestX402PaymentHeader({
      deps: params.deps,
      idempotencyKey: params.idempotencyKey,
      expectedAgentKey: params.agentKey,
    });
    x402Metadata = {
      payerAddress: payment.payerAddress,
      payerAgentKey: payment.payerAgentKey,
      x402Token: payment.x402Token,
      x402Amount: payment.x402Amount,
      x402Network: payment.x402Network,
    };

    const response = await fetchHubWithTimeout({
      deps: params.deps,
      url: NEYNAR_HUB_SUBMIT_URL,
      init: {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-PAYMENT": payment.xPayment,
        },
        body: Buffer.from(params.messageBytes),
      },
      timeoutMs: HUB_SUBMIT_TIMEOUT_MS,
      timeoutLabel: "Neynar hub request",
    });
    const responseText = await response.text();

    if (
      response.status === HUB_PAYMENT_RETRYABLE_STATUS &&
      attempt + 1 < HUB_SUBMIT_MAX_ATTEMPTS
    ) {
      continue;
    }

    return {
      hubResponseStatus: response.status,
      hubResponseText: responseText,
      x402: x402Metadata ?? {
        payerAddress: null,
        payerAgentKey: params.agentKey,
        x402Token: null,
        x402Amount: null,
        x402Network: null,
      },
    };
  }

  if (x402Metadata) {
    throw new Error("Failed to submit cast to Neynar hub.");
  }

  throw new Error("Failed to submit cast to Neynar hub.");
}

async function handleFarcasterSignupCommand(args: string[], deps: CliDeps): Promise<void> {
  const normalizedArgs = normalizeSignupArgs(args);
  const parsed = parseArgs({
    options: {
      agent: { type: "string" },
      recovery: { type: "string" },
      "extra-storage": { type: "string" },
      "out-dir": { type: "string" },
    },
    args: normalizedArgs,
    allowPositionals: false,
    strict: true,
  });

  const current = readConfig(deps);
  const agentKey = resolveAgentKey(parsed.values.agent, current.agent);

  const recovery = parsed.values.recovery?.trim();
  if (recovery) {
    validateEvmAddress(recovery, "--recovery");
  }

  const extraStorage = parseExtraStorage(parsed.values["extra-storage"]);
  const outDir = normalizeDirectoryOption(parsed.values["out-dir"], "--out-dir");
  const outputDirectory = resolveSignerOutputDirectory({
    deps,
    agentKey,
    outDir,
  });

  const signerPrivateKey = generateEd25519PrivateKey();
  const signerPublicKey = bytesToHex(
    await ed.getPublicKeyAsync(signerPrivateKey)
  ) as `0x${string}`;

  let response: unknown;
  try {
    response = await apiPost(deps, "/api/buildbot/farcaster/signup", {
      signerPublicKey,
      ...(recovery ? { recoveryAddress: recovery } : {}),
      ...(extraStorage ? { extraStorage } : {}),
    });
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 409) {
      const payload = asRecord(error.payload);
      const details = asRecord(payload.details);
      const fid = typeof details.fid === "string" ? details.fid : null;
      const custodyAddress =
        typeof details.custodyAddress === "string" ? details.custodyAddress : null;
      const detailParts = [
        fid ? `fid=${fid}` : null,
        custodyAddress ? `custodyAddress=${custodyAddress}` : null,
      ].filter((value): value is string => Boolean(value));
      const detailSuffix = detailParts.length > 0 ? ` (${detailParts.join(", ")})` : "";
      throw new Error(
        `Farcaster account already exists for this agent wallet${detailSuffix}. Use a different --agent key for a new Farcaster signup.`
      );
    }
    throw error;
  }

  const payload = asRecord(response);
  const result = asRecord(payload.result);
  const status = typeof result.status === "string" ? result.status : null;
  if (status === "complete") {
    saveSignerSecret({
      deps,
      config: current,
      agentKey,
      outputDirectory,
      signerPublicKey,
      signerPrivateKey,
      result,
    });
    printJson(deps, withSignerInfo(payload, signerPublicKey, true));
    return;
  }

  printJson(deps, withSignerInfo(payload, signerPublicKey, false));
}

async function handleFarcasterPostCommand(args: string[], deps: CliDeps): Promise<void> {
  const parsed = parseArgs({
    options: {
      text: { type: "string" },
      fid: { type: "string" },
      "signer-file": { type: "string" },
      "idempotency-key": { type: "string" },
      verify: { type: "boolean", default: false },
    },
    args,
    allowPositionals: false,
    strict: true,
  });

  const text = normalizeTextOption(parsed.values.text);
  if (!text) {
    throw new Error(FARCASTER_USAGE);
  }

  const current = readConfig(deps);
  const agentKey = resolveAgentKey(undefined, current.agent);
  const idempotencyKey = resolveExecIdempotencyKey(parsed.values["idempotency-key"], deps);
  const verify = parsed.values.verify ?? false;
  const signerFile = normalizeSignerFileOption(parsed.values["signer-file"]);
  const signerFilePath = resolveSignerFilePath({
    deps,
    agentKey,
    signerFile,
  });
  const signer = readStoredSigner({
    deps,
    config: current,
    agentKey,
    signerFilePath,
  });
  const fid = resolvePostFid({
    inputFid: parsed.values.fid,
    signerFid: signer.fid,
  });

  const receiptPath = resolvePostReceiptPath({
    deps,
    agentKey,
    idempotencyKey,
  });
  const existingReceipt = readPostReceipt({
    deps,
    receiptPath,
  });
  if (existingReceipt) {
    assertPostReceiptMatch({
      receipt: existingReceipt,
      idempotencyKey,
      fid,
      text,
      verify,
    });
    if (existingReceipt.state === "succeeded" && existingReceipt.result) {
      printJson(deps, {
        ok: true,
        replayed: true,
        idempotencyKey,
        result: buildPostResultPayload({
          fid,
          text,
          castHashHex: existingReceipt.castHashHex,
          result: existingReceipt.result,
          fallbackAgentKey: agentKey,
        }),
      });
      return;
    }
  }

  const resumePending = existingReceipt?.state === "pending" ? existingReceipt : null;
  let castHashHex: HexString;
  let messageBytes: Uint8Array;
  let messageBytesBase64: string;

  if (resumePending) {
    castHashHex = resumePending.castHashHex;
    messageBytesBase64 = resumePending.messageBytesBase64;
    messageBytes = decodeMessageBytesBase64(messageBytesBase64);
  } else {
    let cast: { messageBytes: Uint8Array; castHashHex: HexString };
    try {
      cast = await buildCastMessage({
        fid,
        text,
        signerPrivateKeyHex: signer.privateKeyHex,
      });
    } catch (error) {
      throwWithIdempotencyKey(error, idempotencyKey);
    }
    castHashHex = cast.castHashHex;
    messageBytes = cast.messageBytes;
    messageBytesBase64 = encodeMessageBytesBase64(messageBytes);

    writePostReceipt({
      deps,
      receiptPath,
      receipt: {
        version: POST_RECEIPT_VERSION,
        idempotencyKey,
        state: "pending",
        request: {
          fid,
          text,
          verify,
        },
        castHashHex,
        messageBytesBase64,
        savedAt: new Date().toISOString(),
      },
    });
  }

  let submitResult: {
    hubResponseStatus: number;
    hubResponseText: string;
    x402: Omit<X402PaymentHeader, "xPayment">;
  };
  let verification: FarcasterPostVerifyResult | undefined;
  try {
    submitResult = await submitCastToHub({
      deps,
      idempotencyKey,
      agentKey,
      messageBytes,
    });

    if (submitResult.hubResponseStatus < 200 || submitResult.hubResponseStatus >= 300) {
      const detail = sanitizeHubErrorText(submitResult.hubResponseText);
      const suffix = detail ? `: ${detail}` : "";
      throw new Error(
        `Neynar hub rejected Farcaster cast submit (status ${submitResult.hubResponseStatus})${suffix}`
      );
    }

    if (verify) {
      verification = await verifyCastInclusion({
        deps,
        idempotencyKey,
        agentKey,
        fid,
        castHashHex,
      });
    }
  } catch (error) {
    throwWithIdempotencyKey(error, idempotencyKey);
  }

  const result: FarcasterPostReceiptResult = {
    hubResponseStatus: submitResult.hubResponseStatus,
    hubResponseText: submitResult.hubResponseText,
    payerAddress: submitResult.x402.payerAddress,
    payerAgentKey: submitResult.x402.payerAgentKey,
    x402Token: submitResult.x402.x402Token,
    x402Amount: submitResult.x402.x402Amount,
    x402Network: submitResult.x402.x402Network,
    ...(verification ? { verification } : {}),
  };

  writePostReceipt({
    deps,
    receiptPath,
    receipt: {
      version: POST_RECEIPT_VERSION,
      idempotencyKey,
      state: "succeeded",
      request: {
        fid,
        text,
        verify,
      },
      castHashHex,
      messageBytesBase64,
      result,
      savedAt: new Date().toISOString(),
    },
  });

  printJson(deps, {
    ok: true,
    replayed: false,
    resumedPending: Boolean(resumePending),
    idempotencyKey,
    result: buildPostResultPayload({
      fid,
      text,
      castHashHex,
      result,
      fallbackAgentKey: agentKey,
    }),
  });
}

export async function handleFarcasterCommand(args: string[], deps: CliDeps): Promise<void> {
  const [subcommand, ...rest] = args;
  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    throw new Error(FARCASTER_USAGE);
  }

  if (subcommand === "signup") {
    await handleFarcasterSignupCommand(rest, deps);
    return;
  }

  if (subcommand === "post") {
    await handleFarcasterPostCommand(rest, deps);
    return;
  }

  throw new Error(`Unknown farcaster subcommand: ${subcommand}`);
}
