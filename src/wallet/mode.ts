import { normalizeCliWalletInitMode, type CliWalletInitMode } from "@cobuild/wire";

export type WalletInitMode = CliWalletInitMode;

const WALLET_MODE_ERROR = "must be one of: hosted, local-generate, local-key";

export function normalizeWalletInitMode(value: string, optionName: string): WalletInitMode {
  try {
    return normalizeCliWalletInitMode(value);
  } catch {
    throw new Error(`${optionName} ${WALLET_MODE_ERROR}`);
  }
}

export function normalizeOptionalWalletInitMode(
  value: string | undefined,
  optionName: string
): WalletInitMode | undefined {
  if (value === undefined) {
    return undefined;
  }
  return normalizeWalletInitMode(value, optionName);
}

export function parseWalletModePromptAnswer(answer: string): WalletInitMode | null {
  const normalized = answer.trim().toLowerCase();
  if (normalized === "1") return "hosted";
  if (normalized === "2") return "local-generate";
  if (normalized === "3") return "local-key";

  try {
    return normalizeCliWalletInitMode(normalized);
  } catch {
    return null;
  }
}
