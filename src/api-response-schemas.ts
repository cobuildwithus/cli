import { z } from "incur";

const LooseObjectSchema = z.object({}).passthrough();

function asLooseRecord(value: unknown): Record<string, unknown> | null {
  const parsed = LooseObjectSchema.safeParse(value);
  if (!parsed.success) {
    return null;
  }
  return parsed.data;
}

function parseStringValue(value: unknown): string | null {
  const parsed = z.string().safeParse(value);
  if (!parsed.success) {
    return null;
  }
  return parsed.data;
}

function parseStringPath(payload: unknown, path: string[]): string | null {
  let current: unknown = payload;
  for (const key of path) {
    const record = asLooseRecord(current);
    if (!record) {
      return null;
    }
    current = record[key];
  }
  return parseStringValue(current);
}

export function parseCliWalletAddressForSetupSummary(payload: unknown): string | null {
  return parseStringPath(payload, ["wallet", "address"]);
}

export function parseCliWalletAddressCandidates(payload: unknown): {
  resultOwnerAccountAddress: string | null;
  resultWalletAddress: string | null;
  ownerAccountAddress: string | null;
  walletAddress: string | null;
} | null {
  const root = asLooseRecord(payload);
  if (!root) {
    return null;
  }

  return {
    resultOwnerAccountAddress: parseStringPath(root, ["result", "ownerAccountAddress"]),
    resultWalletAddress: parseStringPath(root, ["result", "wallet", "address"]),
    ownerAccountAddress: parseStringValue(root.ownerAccountAddress),
    walletAddress: parseStringPath(root, ["wallet", "address"]),
  };
}
