import type { CliDeps } from "../types.js";

export type WalletPrivateKeyHex = `0x${string}`;

function isHex32BytePrivateKey(value: unknown): value is WalletPrivateKeyHex {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

export function normalizePrivateKeyHex(value: string): WalletPrivateKeyHex {
  const trimmed = value.trim();
  const withPrefix = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
  if (!isHex32BytePrivateKey(withPrefix)) {
    throw new Error("Private key must be 32 bytes hex (0x + 64 hex chars).");
  }
  return withPrefix.toLowerCase() as WalletPrivateKeyHex;
}

export function readTrimmedTextFromFile(
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

export async function readTrimmedTextFromStdin(
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
