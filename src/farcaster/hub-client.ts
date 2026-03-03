import {
  CastType,
  FarcasterNetwork,
  Message,
  NobleEd25519Signer,
  makeCastAdd,
} from "@farcaster/hub-nodejs";
import { hexToBytes } from "viem";
import type { CliDeps } from "../types.js";
import {
  HUB_PAYMENT_RETRYABLE_STATUS,
  HUB_SUBMIT_MAX_ATTEMPTS,
  HUB_SUBMIT_TIMEOUT_MS,
  HUB_VERIFY_TIMEOUT_MS,
  NEYNAR_HUB_CAST_BY_ID_URL,
  NEYNAR_HUB_SUBMIT_URL,
  VERIFY_DELAY_MS,
  VERIFY_POLL_MAX_ATTEMPTS,
  X402_VALUE_USDC_DISPLAY,
} from "./constants.js";
import type {
  FarcasterPostVerifyResult,
  FarcasterReplyTarget,
  HexString,
  ResolvedPostPayer,
  X402PaymentHeader,
  X402VerifyMode,
} from "./types.js";
import { requestX402PaymentHeader } from "./x402.js";

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

export async function buildCastMessage(params: {
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

export function sanitizeHubErrorText(text: string): string {
  const sanitized = text.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim();
  if (!sanitized) {
    return "";
  }
  return sanitized.length > 240 ? `${sanitized.slice(0, 237)}...` : sanitized;
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

export async function verifyCastInclusion(params: {
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

export async function submitCastToHub(params: {
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
