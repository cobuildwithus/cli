import path from "node:path";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { parseCliWalletAddressCandidates } from "../api-response-schemas.js";
import { buildWalletPayerRef, isSecretRef } from "../secrets/ref-contract.js";
import { resolveSecretRefString, setSecretRefString, withDefaultSecretProviders } from "../secrets/runtime.js";
import { apiGet, asRecord } from "../transport.js";
import type { CliConfig, CliDeps } from "../types.js";
import {
  normalizePrivateKeyHex,
  readTrimmedTextFromFile,
  readTrimmedTextFromStdin,
} from "../wallet/key-input.js";
import {
  normalizeOptionalWalletInitMode,
  parseWalletModePromptAnswer,
} from "../wallet/mode.js";
import {
  PAYER_FILE_NAME,
  X402_NETWORK,
  X402_TOKEN_SYMBOL,
  X402_VALUE_MICRO_USDC,
} from "./constants.js";
import type {
  HexString,
  ResolvedPostPayer,
  StoredX402PayerConfig,
  X402InitMode,
  X402PayerSetupResult,
} from "./types.js";

interface MaskingWriter extends Writable {
  setMuted(value: boolean): void;
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

function isInteractive(deps: Pick<CliDeps, "isInteractive">): boolean {
  if (deps.isInteractive) {
    return deps.isInteractive();
  }
  return Boolean(process.stdin.isTTY && process.stderr.isTTY);
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
  deps.stderr("How should this wallet run paid calls?");
  deps.stderr("  1) hosted");
  deps.stderr("  2) local-generate");
  deps.stderr("  3) local-key");

  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  try {
    const answer = await rl.question("Select mode [1-3]: ");
    const selected = parseWalletModePromptAnswer(answer);
    if (selected) return selected;
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

export function readStoredX402PayerConfig(params: {
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

export function writeStoredX402PayerConfig(params: {
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
  const candidates = parseCliWalletAddressCandidates(payload);
  if (!candidates) {
    return null;
  }

  if (candidates.resultOwnerAccountAddress !== null) {
    if (!isEvmAddress(candidates.resultOwnerAccountAddress)) {
      throw new Error("Backend wallet response returned invalid EVM address at result.ownerAccountAddress.");
    }
    return candidates.resultOwnerAccountAddress;
  }
  if (candidates.resultWalletAddress !== null) {
    if (!isEvmAddress(candidates.resultWalletAddress)) {
      throw new Error("Backend wallet response returned invalid EVM address at result.wallet.address.");
    }
    return candidates.resultWalletAddress;
  }
  if (candidates.ownerAccountAddress !== null) {
    if (!isEvmAddress(candidates.ownerAccountAddress)) {
      throw new Error("Backend wallet response returned invalid EVM address at ownerAccountAddress.");
    }
    return candidates.ownerAccountAddress;
  }
  if (candidates.walletAddress !== null) {
    if (!isEvmAddress(candidates.walletAddress)) {
      throw new Error("Backend wallet response returned invalid EVM address at wallet.address.");
    }
    return candidates.walletAddress;
  }

  return null;
}

export async function fetchHostedPayerAddress(params: {
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
      network: X402_NETWORK,
      token: X402_TOKEN_SYMBOL,
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
      network: X402_NETWORK,
      token: X402_TOKEN_SYMBOL,
      createdAt: new Date().toISOString(),
    },
  });
  return {
    mode: "hosted",
    payerAddress,
  };
}

export function resolveLocalPayerPrivateKey(params: {
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
  const explicitMode = normalizeOptionalWalletInitMode(params.modeArg, "--mode");
  if (explicitMode) {
    return explicitMode;
  }

  if (params.noPrompt || !isInteractive(params.deps)) {
    throw new Error(
      "Missing --mode in non-interactive mode. Run: cli wallet init --mode hosted|local-generate|local-key"
    );
  }

  return promptSelectX402Mode(params.deps);
}

export async function runX402InitWorkflow(params: {
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

export function printX402FundingHints(
  deps: Pick<CliDeps, "stderr">,
  setup: X402PayerSetupResult
): void {
  deps.stderr("");
  deps.stderr(`Wallet mode: ${setup.mode}`);
  if (setup.payerAddress) {
    deps.stderr(`Wallet address: ${setup.payerAddress}`);
    deps.stderr("Fund with USDC on Base. Suggested buffer: 0.10 USDC (~100 paid calls).");
  } else {
    /* v8 ignore next */
    deps.stderr("Wallet address is not available yet. Run `cli wallet status` after wallet bootstrap.");
  }
  if (setup.mode === "local") {
    deps.stderr("Local wallet keys are stored in local file-backed secrets. Keep this wallet as low-balance hot funds.");
  } else {
    deps.stderr("Hosted mode requires CLI auth and backend wallet access.");
  }
}

export async function ensurePayerConfigForPost(params: {
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
      "Missing wallet config. Run `cli wallet init --agent <key> --mode hosted|local-generate|local-key`."
    );
  }

  /* v8 ignore start */
  params.deps.stderr("No wallet configured for this agent. Starting setup...");
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
  /* v8 ignore stop */
}

export function resolvePostPayer(params: {
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

export function getX402WalletPayerCostMicroUsdc(): string {
  return X402_VALUE_MICRO_USDC;
}
