import path from "node:path";
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import * as ed from "@noble/ed25519";
import {
  CastType,
  FarcasterNetwork,
  Message,
  NobleEd25519Signer,
  makeCastAdd,
} from "@farcaster/hub-nodejs";
import { bytesToHex, hexToBytes } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { readConfig } from "../config.js";
import { ApiRequestError, asRecord, apiGet, apiPost } from "../transport.js";
import type { CliConfig, CliDeps, SecretRef } from "../types.js";
import {
  buildFarcasterSignerRef,
  buildWalletPayerRef,
  isSecretRef,
} from "../secrets/ref-contract.js";
import { resolveSecretRefString, setSecretRefString, withDefaultSecretProviders } from "../secrets/runtime.js";
import {
  normalizeEvmAddress,
  resolveAgentKey,
  resolveExecIdempotencyKey,
  throwWithIdempotencyKey,
} from "./shared.js";

const FARCASTER_USAGE = `Usage:
  cli farcaster signup [--agent <key>] [--recovery <0x...>] [--extra-storage <n>] [--out-dir <path>]
  cli farcaster post --text <text> [--fid <n>] [--reply-to <parent-fid:0x-parent-hash>] [--signer-file <path>] [--idempotency-key <key>] [--verify[=once|poll]|--verify=none]`;
const SIGNER_FILE_NAME = "ed25519-signer.json";
const PAYER_FILE_NAME = "payer.json";
const NEYNAR_HUB_SUBMIT_URL = "https://hub-api.neynar.com/v1/submitMessage";
const NEYNAR_HUB_CAST_BY_ID_URL = "https://hub-api.neynar.com/v1/castById";
const HUB_PAYMENT_RETRYABLE_STATUS = 402;
const HUB_SUBMIT_MAX_ATTEMPTS = 2;
const HUB_SUBMIT_TIMEOUT_MS = 30_000;
const HUB_VERIFY_TIMEOUT_MS = 10_000;
const VERIFY_DELAY_MS = 1_200;
const VERIFY_POLL_MAX_ATTEMPTS = 5;
const FARCASTER_MAX_CAST_TEXT_BYTES = 320;
const FARCASTER_CAST_HASH_HEX_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const POST_RECEIPT_VERSION = 1;
const X402_VERSION = 1;
const X402_SCHEME = "exact";
const X402_NETWORK = "base";
const X402_TOKEN_SYMBOL = "usdc";
const X402_USDC_CONTRACT = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const X402_PAY_TO_ADDRESS = "0xA6a8736f18f383f1cc2d938576933E5eA7Df01A1".toLowerCase();
const X402_VALUE_MICRO_USDC = "1000";
const X402_VALUE_USDC_DISPLAY = "0.001";
const BASE_CHAIN_ID = 8453;
const USDC_EIP712_DOMAIN_NAME = "USD Coin";
const USDC_EIP712_DOMAIN_VERSION = "2";
const X402_AUTH_VALID_AFTER = "0";
const X402_AUTH_TTL_SECONDS = 300;

type X402VerifyMode = "none" | "once" | "poll";
type X402PayerMode = "hosted" | "local";
type X402InitMode = "hosted" | "local-generate" | "local-key";

interface MaskingWriter extends Writable {
  setMuted(value: boolean): void;
}

type HexString = `0x${string}`;
type FarcasterReplyTarget = {
  parentAuthorFid: number;
  parentHashHex: HexString;
};

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
    verifyMode?: "once" | "poll";
    replyTo?: FarcasterReplyTarget;
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

type StoredX402PayerConfig = {
  version: 1;
  mode: X402PayerMode;
  payerAddress: string | null;
  payerRef?: SecretRef;
  network: "base";
  token: "usdc";
  createdAt: string;
};

type X402PayerSetupResult = {
  mode: X402PayerMode;
  payerAddress: string | null;
};

type ResolvedPostPayer =
  | {
      mode: "hosted";
      payerAddress: string | null;
    }
  | {
      mode: "local";
      payerAddress: string;
      privateKeyHex: HexString;
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

function parseReplyToOption(value: string | undefined): FarcasterReplyTarget | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("--reply-to cannot be empty");
  }

  const separator = trimmed.indexOf(":");
  if (separator <= 0 || separator === trimmed.length - 1) {
    throw new Error("--reply-to must be in the format <parent-fid:0x-parent-hash>");
  }

  const parentFidRaw = trimmed.slice(0, separator).trim();
  const parentHashRaw = trimmed.slice(separator + 1).trim().toLowerCase();
  if (!/^\d+$/.test(parentFidRaw)) {
    throw new Error("--reply-to parent fid must be a positive integer");
  }
  const parentAuthorFid = Number.parseInt(parentFidRaw, 10);
  if (!Number.isSafeInteger(parentAuthorFid) || parentAuthorFid <= 0) {
    throw new Error("--reply-to parent fid must be a positive integer");
  }
  if (!FARCASTER_CAST_HASH_HEX_PATTERN.test(parentHashRaw)) {
    throw new Error("--reply-to parent hash must be 0x + 40 hex chars");
  }

  return {
    parentAuthorFid,
    parentHashHex: parentHashRaw as HexString,
  };
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

function resolveWalletPayerFilePath(params: {
  deps: Pick<CliDeps, "homedir">;
  agentKey: string;
}): string {
  return path.join(
    params.deps.homedir(),
    ".cobuild-cli",
    "agents",
    params.agentKey,
    "wallet",
    PAYER_FILE_NAME
  );
}

function resolveVerifyMode(input: string | undefined): X402VerifyMode {
  if (input === undefined) return "none";
  const normalized = input.trim().toLowerCase();
  if (normalized === "none" || normalized === "false") return "none";
  if (normalized === "once" || normalized === "true") return "once";
  if (normalized === "poll") return "poll";
  throw new Error("--verify must be one of: none, once, poll");
}

function isInteractive(deps: Pick<CliDeps, "isInteractive">): boolean {
  if (deps.isInteractive) {
    return deps.isInteractive();
  }
  return Boolean(process.stdin.isTTY && process.stderr.isTTY);
}

function readTrimmedTextFromFile(
  deps: Pick<CliDeps, "fs">,
  filePath: string,
  label: string
): string {
  let raw: string;
  try {
    raw = deps.fs.readFileSync(filePath, "utf8");
  } catch (error) {
    throw new Error(
      `Could not read ${label} file: ${filePath} (${error instanceof Error ? error.message : String(error)})`
    );
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error(`${label} file is empty: ${filePath}`);
  }
  return trimmed;
}

async function readTrimmedTextFromStdin(
  deps: Pick<CliDeps, "readStdin">,
  label: string
): Promise<string> {
  if (deps.readStdin) {
    const value = (await deps.readStdin()).trim();
    if (!value) {
      throw new Error(`${label} stdin input is empty.`);
    }
    return value;
  }

  /* c8 ignore start */
  if (process.stdin.isTTY) {
    throw new Error(`Refusing --${label.toLowerCase().replace(/\s+/g, "-")}-stdin from interactive TTY.`);
  }
  process.stdin.setEncoding("utf8");
  const raw = await new Promise<string>((resolve, reject) => {
    let buffer = "";
    process.stdin.on("data", (chunk: string) => {
      buffer += chunk;
    });
    process.stdin.once("end", () => resolve(buffer));
    process.stdin.once("error", reject);
  });
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error(`${label} stdin input is empty.`);
  }
  return trimmed;
  /* c8 ignore stop */
}

/* c8 ignore start */
function createMaskingWriter(onWrite: (chunk: string) => void): MaskingWriter {
  let muted = false;
  const writer = new Writable({
    write(chunk, _encoding, callback) {
      const text = chunk.toString("utf8");
      if (muted && text && text !== "\n" && text !== "\r\n") {
        onWrite("*".repeat(text.length));
      } else {
        onWrite(text);
      }
      callback();
    },
    final(callback) {
      callback();
    },
    destroy(error, callback) {
      callback(error);
    },
  });
  return Object.assign(writer, {
    setMuted(value: boolean) {
      muted = value;
    },
  });
}
/* c8 ignore stop */

/* c8 ignore start */
async function promptSelectX402Mode(
  deps: Pick<CliDeps, "stderr">
): Promise<X402InitMode> {
  deps.stderr("How should this agent pay for paid calls?");
  deps.stderr("  1) hosted (recommended)");
  deps.stderr("  2) local-generate");
  deps.stderr("  3) local-key");

  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  try {
    const answer = (await rl.question("Select mode [1-3]: ")).trim();
    if (answer === "1" || answer.toLowerCase() === "hosted") return "hosted";
    if (answer === "2" || answer.toLowerCase() === "local-generate") return "local-generate";
    if (answer === "3" || answer.toLowerCase() === "local-key") return "local-key";
    throw new Error("Invalid selection. Choose hosted, local-generate, or local-key.");
  } finally {
    rl.close();
  }
}
/* c8 ignore stop */

async function promptMaskedPrivateKey(deps: Pick<CliDeps, "stderr">): Promise<string> {
  /* c8 ignore start */
  const maskingWriter = createMaskingWriter((chunk) => {
    deps.stderr(chunk);
  });
  const rl = createInterface({
    input: process.stdin,
    output: maskingWriter,
    terminal: true,
  });
  try {
    deps.stderr("Enter private key (input hidden):");
    maskingWriter.setMuted(true);
    const answer = (await rl.question("> ")).trim();
    maskingWriter.setMuted(false);
    deps.stderr("");
    if (!answer) {
      throw new Error("Private key input cannot be empty.");
    }
    return answer;
  } finally {
    rl.close();
  }
  /* c8 ignore stop */
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

function normalizePrivateKeyHex(value: string): HexString {
  const trimmed = value.trim();
  const withPrefix = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
  if (!isHex32BytePrivateKey(withPrefix)) {
    throw new Error("Private key must be 32 bytes hex (0x + 64 hex chars).");
  }
  return withPrefix.toLowerCase() as HexString;
}

function isEvmAddress(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
}

function isStoredX402PayerConfig(value: unknown): value is StoredX402PayerConfig {
  const record = asRecord(value);
  const modeValid = record.mode === "hosted" || record.mode === "local";
  const refValid = record.payerRef === undefined || isSecretRef(record.payerRef);
  return (
    record.version === 1 &&
    modeValid &&
    (record.payerAddress === null || isEvmAddress(record.payerAddress)) &&
    record.network === "base" &&
    record.token === "usdc" &&
    typeof record.createdAt === "string" &&
    refValid
  );
}

function readStoredX402PayerConfig(params: {
  deps: Pick<CliDeps, "fs" | "homedir">;
  agentKey: string;
}): StoredX402PayerConfig | null {
  const payerPath = resolveWalletPayerFilePath(params);
  if (!params.deps.fs.existsSync(payerPath)) {
    return null;
  }

  let raw: string;
  try {
    raw = params.deps.fs.readFileSync(payerPath, "utf8");
  } catch {
    throw new Error("Failed to read payer config.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Payer config is invalid JSON.");
  }

  if (!isStoredX402PayerConfig(parsed)) {
    throw new Error("Payer config has invalid shape.");
  }

  return parsed;
}

function writeStoredX402PayerConfig(params: {
  deps: Pick<CliDeps, "fs" | "homedir">;
  agentKey: string;
  config: StoredX402PayerConfig;
}): string {
  const payerPath = resolveWalletPayerFilePath(params);
  const payerDir = path.dirname(payerPath);
  params.deps.fs.mkdirSync(payerDir, { recursive: true, mode: 0o700 });
  params.deps.fs.writeFileSync(payerPath, JSON.stringify(params.config, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  params.deps.fs.chmodSync?.(payerPath, 0o600);
  return payerPath;
}

function resolveWalletAddressFromPayload(payload: unknown): string | null {
  const root = asRecord(payload);
  const result = asRecord(root.result);
  const ownerAccountAddress = result.ownerAccountAddress;
  if (typeof ownerAccountAddress === "string") {
    if (!isEvmAddress(ownerAccountAddress)) {
      throw new Error("Backend wallet response returned invalid EVM address at result.ownerAccountAddress.");
    }
    return ownerAccountAddress;
  }
  const wallet = asRecord(result.wallet);
  if (typeof wallet.address === "string") {
    if (!isEvmAddress(wallet.address)) {
      throw new Error("Backend wallet response returned invalid EVM address at result.wallet.address.");
    }
    return wallet.address;
  }
  if (typeof root.ownerAccountAddress === "string") {
    if (!isEvmAddress(root.ownerAccountAddress)) {
      throw new Error("Backend wallet response returned invalid EVM address at ownerAccountAddress.");
    }
    return root.ownerAccountAddress;
  }
  return null;
}

async function fetchHostedPayerAddress(params: {
  deps: Pick<CliDeps, "fetch" | "fs" | "homedir">;
  agentKey: string;
}): Promise<string | null> {
  const payload = await apiGet(params.deps, `/api/cli/wallet?agentKey=${encodeURIComponent(params.agentKey)}`);
  return resolveWalletAddressFromPayload(payload);
}

function saveLocalX402Payer(params: {
  deps: Pick<CliDeps, "fs" | "homedir">;
  currentConfig: CliConfig;
  agentKey: string;
  privateKeyHex: HexString;
}): X402PayerSetupResult {
  const configWithProviders = withDefaultSecretProviders(params.currentConfig, params.deps);
  const payerRef = buildWalletPayerRef(configWithProviders, params.agentKey);
  setSecretRefString({
    deps: params.deps,
    config: configWithProviders,
    ref: payerRef,
    value: params.privateKeyHex,
  });

  const payerAddress = privateKeyToAccount(params.privateKeyHex).address;
  writeStoredX402PayerConfig({
    deps: params.deps,
    agentKey: params.agentKey,
    config: {
      version: 1,
      mode: "local",
      payerAddress,
      payerRef,
      network: "base",
      token: "usdc",
      createdAt: new Date().toISOString(),
    },
  });
  return {
    mode: "local",
    payerAddress,
  };
}

async function saveHostedX402Payer(params: {
  deps: Pick<CliDeps, "fetch" | "fs" | "homedir">;
  agentKey: string;
}): Promise<X402PayerSetupResult> {
  let payerAddress: string | null;
  try {
    payerAddress = await fetchHostedPayerAddress({
      deps: params.deps,
      agentKey: params.agentKey,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Hosted payer setup requires backend wallet access: ${message}`);
  }
  writeStoredX402PayerConfig({
    deps: params.deps,
    agentKey: params.agentKey,
    config: {
      version: 1,
      mode: "hosted",
      payerAddress,
      network: "base",
      token: "usdc",
      createdAt: new Date().toISOString(),
    },
  });
  return {
    mode: "hosted",
    payerAddress,
  };
}

function resolveLocalPayerPrivateKey(params: {
  deps: Pick<CliDeps, "fs" | "homedir" | "env">;
  currentConfig: CliConfig;
  payerConfig: StoredX402PayerConfig;
}): HexString {
  if (params.payerConfig.mode !== "local" || !isSecretRef(params.payerConfig.payerRef)) {
    throw new Error("Local payer config is missing payerRef.");
  }
  const configWithProviders = withDefaultSecretProviders(params.currentConfig, params.deps);
  const privateKey = resolveSecretRefString({
    deps: params.deps,
    config: configWithProviders,
    ref: params.payerConfig.payerRef,
  });
  return normalizePrivateKeyHex(privateKey);
}

async function resolvePayerSetupMode(params: {
  deps: Pick<CliDeps, "isInteractive" | "stderr">;
  modeArg: string | undefined;
  noPrompt: boolean;
}): Promise<X402InitMode> {
  if (params.modeArg) {
    const mode = params.modeArg.trim().toLowerCase();
    if (mode === "hosted" || mode === "local-generate" || mode === "local-key") {
      return mode;
    }
    throw new Error("--mode must be one of: hosted, local-generate, local-key");
  }

  if (params.noPrompt || !isInteractive(params.deps)) {
    throw new Error(
      "Missing --mode in non-interactive mode. Run: cli wallet payer init --mode hosted|local-generate|local-key"
    );
  }

  return promptSelectX402Mode(params.deps);
}

async function runX402InitWorkflow(params: {
  deps: Pick<CliDeps, "fetch" | "fs" | "homedir" | "env" | "readStdin" | "isInteractive" | "stderr">;
  currentConfig: CliConfig;
  agentKey: string;
  modeArg: string | undefined;
  noPrompt: boolean;
  privateKeyStdin: boolean;
  privateKeyFile: string | undefined;
}): Promise<X402PayerSetupResult> {
  if (params.privateKeyStdin && params.privateKeyFile) {
    throw new Error("Provide only one of --private-key-stdin or --private-key-file.");
  }

  const mode = await resolvePayerSetupMode({
    deps: params.deps,
    modeArg: params.modeArg,
    noPrompt: params.noPrompt,
  });

  if (mode !== "local-key" && (params.privateKeyStdin || params.privateKeyFile)) {
    throw new Error("--private-key-stdin/--private-key-file require --mode local-key.");
  }

  if (mode === "hosted") {
    return saveHostedX402Payer({
      deps: params.deps,
      agentKey: params.agentKey,
    });
  }

  if (mode === "local-generate") {
    const privateKeyHex = generatePrivateKey();
    return saveLocalX402Payer({
      deps: params.deps,
      currentConfig: params.currentConfig,
      agentKey: params.agentKey,
      privateKeyHex,
    });
  }

  let privateKeyInput: string;
  if (params.privateKeyStdin) {
    privateKeyInput = await readTrimmedTextFromStdin(params.deps, "Private key");
  } else if (params.privateKeyFile) {
    privateKeyInput = readTrimmedTextFromFile(params.deps, params.privateKeyFile, "private key");
  } else if (params.noPrompt || !isInteractive(params.deps)) {
    throw new Error("local-key mode requires --private-key-stdin or --private-key-file in non-interactive mode.");
  } else {
    privateKeyInput = await promptMaskedPrivateKey(params.deps);
  }

  return saveLocalX402Payer({
    deps: params.deps,
    currentConfig: params.currentConfig,
    agentKey: params.agentKey,
    privateKeyHex: normalizePrivateKeyHex(privateKeyInput),
  });
}

function printX402FundingHints(
  deps: Pick<CliDeps, "stderr">,
  setup: X402PayerSetupResult
): void {
  deps.stderr("");
  deps.stderr(`Payer mode: ${setup.mode}`);
  if (setup.payerAddress) {
    deps.stderr(`Payer address: ${setup.payerAddress}`);
    deps.stderr("Fund with USDC on Base. Suggested buffer: 0.10 USDC (~100 paid calls).");
  } else {
    deps.stderr("Payer address is not available yet. Run `cli wallet payer status` after wallet bootstrap.");
  }
  if (setup.mode === "local") {
    deps.stderr("Local payer keys are stored in local file-backed secrets. Keep this wallet as low-balance hot funds.");
  } else {
    deps.stderr("Hosted mode requires CLI auth and backend wallet access.");
  }
}

async function ensurePayerConfigForPost(params: {
  deps: Pick<CliDeps, "fetch" | "fs" | "homedir" | "env" | "readStdin" | "isInteractive" | "stderr">;
  currentConfig: CliConfig;
  agentKey: string;
}): Promise<StoredX402PayerConfig> {
  const existing = readStoredX402PayerConfig({
    deps: params.deps,
    agentKey: params.agentKey,
  });
  if (existing) {
    return existing;
  }

  if (!isInteractive(params.deps)) {
    throw new Error(
      "Missing payer config. Run `cli wallet payer init --agent <key> --mode hosted|local-generate|local-key`."
    );
  }

  params.deps.stderr("No wallet payer configured for this agent. Starting setup...");
  const setup = await runX402InitWorkflow({
    deps: params.deps,
    currentConfig: params.currentConfig,
    agentKey: params.agentKey,
    modeArg: undefined,
    noPrompt: false,
    privateKeyStdin: false,
    privateKeyFile: undefined,
  });
  printX402FundingHints(params.deps, setup);

  const created = readStoredX402PayerConfig({
    deps: params.deps,
    agentKey: params.agentKey,
  });
  if (!created) {
    throw new Error("Failed to persist payer config.");
  }
  return created;
}

function resolvePostPayer(params: {
  deps: Pick<CliDeps, "fs" | "homedir" | "env">;
  currentConfig: CliConfig;
  agentKey: string;
  payerConfig: StoredX402PayerConfig;
}): ResolvedPostPayer {
  if (params.payerConfig.mode === "hosted") {
    return {
      mode: "hosted",
      payerAddress: params.payerConfig.payerAddress,
    };
  }

  const privateKeyHex = resolveLocalPayerPrivateKey({
    deps: params.deps,
    currentConfig: params.currentConfig,
    payerConfig: params.payerConfig,
  });
  return {
    mode: "local",
    payerAddress: privateKeyToAccount(privateKeyHex).address,
    privateKeyHex,
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
  replyTo?: FarcasterReplyTarget;
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
      ...(params.replyTo
        ? {
            parentCastId: {
              fid: params.replyTo.parentAuthorFid,
              hash: hexToBytes(params.replyTo.parentHashHex),
            },
          }
        : {}),
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

async function requestX402PaymentHeader(params: {
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

async function fetchCastById(params: {
  deps: Pick<CliDeps, "fetch" | "fs" | "homedir">;
  agentKey: string;
  payer: ResolvedPostPayer;
  fid: number;
  castHashHex: HexString;
}): Promise<{ status: number; body: string; usedPaidVerificationCall: boolean }> {
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
      usedPaidVerificationCall: false,
    };
  }

  const payment = await requestX402PaymentHeader({
    deps: params.deps,
    expectedAgentKey: params.agentKey,
    payer: params.payer,
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
    usedPaidVerificationCall: true,
  };
}

async function verifyCastInclusion(params: {
  deps: Pick<CliDeps, "fetch" | "fs" | "homedir" | "stderr">;
  agentKey: string;
  payer: ResolvedPostPayer;
  fid: number;
  castHashHex: HexString;
  mode: X402VerifyMode;
}): Promise<FarcasterPostVerifyResult> {
  const maxAttempts = params.mode === "poll" ? VERIFY_POLL_MAX_ATTEMPTS : 1;
  let paidVerificationWarningShown = false;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await waitForMs(VERIFY_DELAY_MS);
    const verification = await fetchCastById({
      deps: params.deps,
      agentKey: params.agentKey,
      payer: params.payer,
      fid: params.fid,
      castHashHex: params.castHashHex,
    });
    if (verification.usedPaidVerificationCall && !paidVerificationWarningShown) {
      paidVerificationWarningShown = true;
      params.deps.stderr(
        `Verification reads hit Neynar hub paywall (HTTP 402); verification calls may cost ${X402_VALUE_USDC_DISPLAY} USDC each.`
      );
    }

    if (verification.status >= 200 && verification.status < 300) {
      return {
        enabled: true,
        included: true,
        attempts: attempt,
      };
    }

    if (verification.status === 404 && params.mode === "poll" && attempt < maxAttempts) {
      continue;
    }

    if (verification.status === 404) {
      if (params.mode === "poll") {
        throw new Error(
          `Cast was not observed in Neynar hub read after ${maxAttempts} verification checks`
        );
      }
      throw new Error("Cast was not observed in Neynar hub read after one delayed verification check");
    }

    const detail = sanitizeHubErrorText(verification.body);
    const suffix = detail ? `: ${detail}` : "";
    throw new Error(
      `Neynar hub cast verification failed (status ${verification.status})${suffix}`
    );
  }

  throw new Error("Cast verification failed unexpectedly.");
}

async function submitCastToHub(params: {
  deps: Pick<CliDeps, "fetch" | "fs" | "homedir">;
  agentKey: string;
  payer: ResolvedPostPayer;
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
      expectedAgentKey: params.agentKey,
      payer: params.payer,
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

  throw new Error("Failed to submit cast to Neynar hub.");
}

export interface FarcasterSignupCommandInput {
  agent?: string;
  recovery?: string;
  extraStorage?: string;
  outDir?: string;
}

export interface WalletPayerInitCommandInput {
  agent?: string;
  mode?: string;
  privateKeyStdin?: boolean;
  privateKeyFile?: string;
  noPrompt?: boolean;
}

export interface WalletPayerStatusCommandInput {
  agent?: string;
}

export interface FarcasterPostCommandInput {
  agent?: string;
  text?: string;
  fid?: string;
  replyTo?: string;
  signerFile?: string;
  idempotencyKey?: string;
  verify?: string;
}

export async function executeFarcasterSignupCommand(
  input: FarcasterSignupCommandInput,
  deps: CliDeps
): Promise<Record<string, unknown>> {
  const current = readConfig(deps);
  const agentKey = resolveAgentKey(input.agent, current.agent);

  const recoveryInput = input.recovery?.trim();
  const recovery = recoveryInput ? normalizeEvmAddress(recoveryInput, "--recovery") : null;

  const extraStorage = parseExtraStorage(input.extraStorage);
  const outDir = normalizeDirectoryOption(input.outDir, "--out-dir");
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
    response = await apiPost(deps, "/api/cli/farcaster/signup", {
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
    return withSignerInfo(payload, signerPublicKey, true);
  }

  return withSignerInfo(payload, signerPublicKey, false);
}

export async function executeWalletPayerInitCommand(
  input: WalletPayerInitCommandInput,
  deps: CliDeps
): Promise<Record<string, unknown>> {
  const current = readConfig(deps);
  const agentKey = resolveAgentKey(input.agent, current.agent);
  const setup = await runX402InitWorkflow({
    deps,
    currentConfig: current,
    agentKey,
    modeArg: input.mode,
    noPrompt: input.noPrompt ?? false,
    privateKeyStdin: input.privateKeyStdin ?? false,
    privateKeyFile: input.privateKeyFile,
  });
  printX402FundingHints(deps, setup);

  return {
    ok: true,
    agentKey,
    payer: {
      mode: setup.mode,
      payerAddress: setup.payerAddress,
      network: X402_NETWORK,
      token: X402_TOKEN_SYMBOL,
      costPerPaidCallMicroUsdc: X402_VALUE_MICRO_USDC,
    },
  };
}

export async function executeWalletPayerStatusCommand(
  input: WalletPayerStatusCommandInput,
  deps: CliDeps
): Promise<Record<string, unknown>> {
  const current = readConfig(deps);
  const agentKey = resolveAgentKey(input.agent, current.agent);
  const stored = readStoredX402PayerConfig({
    deps,
    agentKey,
  });
  if (!stored) {
    throw new Error(
      "No wallet payer is configured for this agent. Run `cli wallet payer init --mode hosted|local-generate|local-key`."
    );
  }

  let payerAddress = stored.payerAddress;
  if (stored.mode === "local") {
    const privateKeyHex = resolveLocalPayerPrivateKey({
      deps,
      currentConfig: current,
      payerConfig: stored,
    });
    payerAddress = privateKeyToAccount(privateKeyHex).address;
  } else if (!payerAddress) {
    try {
      payerAddress = await fetchHostedPayerAddress({
        deps,
        agentKey,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Hosted payer address is unknown and could not be fetched from backend wallet endpoint: ${message}`
      );
    }
  }

  if (payerAddress !== stored.payerAddress) {
    writeStoredX402PayerConfig({
      deps,
      agentKey,
      config: {
        ...stored,
        payerAddress,
      },
    });
  }

  return {
    ok: true,
    agentKey,
    payer: {
      mode: stored.mode,
      payerAddress,
      network: stored.network,
      token: stored.token,
      costPerPaidCallMicroUsdc: X402_VALUE_MICRO_USDC,
    },
  };
}

export async function executeFarcasterPostCommand(
  input: FarcasterPostCommandInput,
  deps: CliDeps
): Promise<Record<string, unknown>> {
  const text = normalizeTextOption(input.text);
  if (!text) {
    throw new Error(FARCASTER_USAGE);
  }

  const current = readConfig(deps);
  const agentKey = resolveAgentKey(input.agent, current.agent);
  const idempotencyKey = resolveExecIdempotencyKey(input.idempotencyKey, deps);
  const verifyMode = resolveVerifyMode(input.verify);
  const verify = verifyMode !== "none";
  const replyTo = parseReplyToOption(input.replyTo);
  const signerFile = normalizeSignerFileOption(input.signerFile);
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
    inputFid: input.fid,
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
      verifyMode,
      replyTo,
    });
    if (existingReceipt.state === "succeeded" && existingReceipt.result) {
      return {
        ok: true,
        replayed: true,
        idempotencyKey,
        result: buildPostResultPayload({
          fid,
          text,
          castHashHex: existingReceipt.castHashHex,
          result: existingReceipt.result,
          fallbackAgentKey: agentKey,
          replyTo: existingReceipt.request.replyTo,
        }),
      };
    }
  }

  const payerConfig = await ensurePayerConfigForPost({
    deps,
    currentConfig: current,
    agentKey,
  });
  const payer = resolvePostPayer({
    deps,
    currentConfig: current,
    agentKey,
    payerConfig,
  });
  if (verifyMode === "poll") {
    deps.stderr(
      `Verification polling may incur up to ${VERIFY_POLL_MAX_ATTEMPTS} additional paid hub calls (${X402_VALUE_USDC_DISPLAY} USDC each).`
    );
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
    /* c8 ignore start */
    try {
      cast = await buildCastMessage({
        fid,
        text,
        signerPrivateKeyHex: signer.privateKeyHex,
        replyTo,
      });
    } catch (error) {
      throwWithIdempotencyKey(error, idempotencyKey);
    }
    /* c8 ignore stop */
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
          ...(replyTo ? { replyTo } : {}),
          ...(verify ? { verifyMode: verifyMode === "poll" ? "poll" : "once" } : {}),
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
      agentKey,
      payer,
      messageBytes,
    });

    if (submitResult.hubResponseStatus < 200 || submitResult.hubResponseStatus >= 300) {
      const detail = sanitizeHubErrorText(submitResult.hubResponseText);
      const suffix = detail ? `: ${detail}` : "";
      throw new Error(
        `Neynar hub rejected Farcaster cast submit (status ${submitResult.hubResponseStatus}, cast ${castHashHex})${suffix}`
      );
    }

    if (verify) {
      verification = await verifyCastInclusion({
        deps,
        agentKey,
        payer,
        fid,
        castHashHex,
        mode: verifyMode,
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
        ...(replyTo ? { replyTo } : {}),
        ...(verify ? { verifyMode: verifyMode === "poll" ? "poll" : "once" } : {}),
      },
      castHashHex,
      messageBytesBase64: "",
      result,
      savedAt: new Date().toISOString(),
    },
  });

  return {
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
      replyTo,
    }),
  };
}
