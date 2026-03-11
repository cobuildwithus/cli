import path from "node:path";
import * as ed from "@noble/ed25519";
import { bytesToHex } from "viem";
import {
  buildFarcasterSignerRef,
  isSecretRef,
} from "../secrets/ref-contract.js";
import {
  resolveSecretRefString,
  setSecretRefString,
  withDefaultSecretProviders,
} from "../secrets/runtime.js";
import { asRecord } from "../transport.js";
import type { CliConfig, CliDeps } from "../types.js";
import { SIGNER_FILE_NAME } from "./constants.js";
import type { HexString, StoredFarcasterSigner } from "./types.js";

export function normalizeDirectoryOption(
  value: string | undefined,
  optionName: string
): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${optionName} cannot be empty`);
  return trimmed;
}

export function normalizeSignerFileOption(value: string | undefined): string | undefined {
  return normalizeDirectoryOption(value, "--signer-file");
}

export function resolveSignerOutputDirectory(params: {
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

export function resolveSignerFilePath(params: {
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

export function generateEd25519PrivateKey(): Uint8Array {
  return ed.utils.randomPrivateKey();
}

export function saveSignerSecret(params: {
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

export function parseFidString(value: string | undefined, optionName: string): number | undefined {
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

export function readStoredSigner(params: {
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
