import path from "node:path";
import { parseArgs } from "node:util";
import * as ed from "@noble/ed25519";
import { bytesToHex } from "viem";
import { readConfig } from "../config.js";
import { printJson } from "../output.js";
import { ApiRequestError, asRecord, apiPost } from "../transport.js";
import type { CliDeps } from "../types.js";
import { resolveAgentKey, validateEvmAddress } from "./shared.js";

const FARCASTER_USAGE = `Usage:
  cli farcaster signup [--agent <key>] [--recovery <0x...>] [--extra-storage <n>] [--out-dir <path>]`;
const SIGNER_FILE_NAME = "ed25519-signer.json";

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

function generateEd25519PrivateKey(): Uint8Array {
  return ed.utils.randomPrivateKey();
}

function saveSignerSecret(params: {
  deps: Pick<CliDeps, "fs">;
  outputDirectory: string;
  signerPublicKey: `0x${string}`;
  signerPrivateKey: Uint8Array;
  result: Record<string, unknown>;
}): void {
  params.deps.fs.mkdirSync(params.outputDirectory, { recursive: true, mode: 0o700 });

  const secretPath = path.join(params.outputDirectory, SIGNER_FILE_NAME);
  const fid = typeof params.result.fid === "string" ? params.result.fid : null;
  const custodyAddress =
    typeof params.result.custodyAddress === "string" ? params.result.custodyAddress : null;
  const payload = {
    version: 1,
    algorithm: "ed25519",
    publicKey: params.signerPublicKey,
    privateKeyHex: bytesToHex(params.signerPrivateKey),
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

export async function handleFarcasterCommand(args: string[], deps: CliDeps): Promise<void> {
  const [subcommand, ...rest] = args;
  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    throw new Error(FARCASTER_USAGE);
  }

  if (subcommand === "signup") {
    await handleFarcasterSignupCommand(rest, deps);
    return;
  }

  throw new Error(`Unknown farcaster subcommand: ${subcommand}`);
}
