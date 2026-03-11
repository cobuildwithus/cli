import { validateFarcasterSignupResponse } from "@cobuild/wire";
import { apiPost } from "../transport.js";
import type { CliDeps } from "../types.js";
import {
  executeFarcasterPostCommand,
  executeFarcasterSignupCommand as executeBaseFarcasterSignupCommand,
} from "../farcaster/command.js";
import type { FarcasterSignupCommandInput } from "../farcaster/command.js";

type WalletLinkSyncSuccess = {
  ok: true;
  fid: number;
  address: `0x${string}`;
};

type WalletLinkSyncFailure = {
  ok: false;
  fid: number;
  address: `0x${string}`;
  error: string;
};

type WalletLinkSyncResult = WalletLinkSyncSuccess | WalletLinkSyncFailure;

function toWalletLinkSyncErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message.length > 0) {
      return message;
    }
  }
  return "Failed to sync Farcaster wallet link.";
}

async function syncWalletLinkAfterSignup(params: {
  payload: Record<string, unknown>;
  deps: CliDeps;
}): Promise<Record<string, unknown>> {
  const signup = validateFarcasterSignupResponse(params.payload);
  if (signup.result.status !== "complete") {
    return params.payload;
  }

  const fid = Number.parseInt(signup.result.fid, 10);
  const address = signup.result.custodyAddress;
  let walletLinkSync: WalletLinkSyncResult;

  try {
    await apiPost(params.deps, "/v1/farcaster/profiles/link-wallet", {
      fid,
      address,
    });
    walletLinkSync = {
      ok: true,
      fid,
      address,
    };
  } catch (error) {
    walletLinkSync = {
      ok: false,
      fid,
      address,
      error: toWalletLinkSyncErrorMessage(error),
    };
  }

  return {
    ...params.payload,
    walletLinkSync,
  };
}

export { executeFarcasterPostCommand };

export async function executeFarcasterSignupCommand(
  input: FarcasterSignupCommandInput,
  deps: CliDeps,
): Promise<Record<string, unknown>> {
  const payload = await executeBaseFarcasterSignupCommand(input, deps);
  return await syncWalletLinkAfterSignup({ payload, deps });
}

export type {
  FarcasterPostCommandInput,
  FarcasterSignupCommandInput,
} from "../farcaster/command.js";
