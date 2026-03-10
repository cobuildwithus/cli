import * as ed from "@noble/ed25519";
import {
  buildFarcasterSignupResponse,
  validateFarcasterSignupAlreadyRegisteredErrorResponse,
  validateFarcasterSignupResponse,
} from "@cobuild/wire";
import { bytesToHex } from "viem";
import { readConfig } from "../config.js";
import { ApiRequestError, apiPost } from "../transport.js";
import type { CliDeps } from "../types.js";
import {
  normalizeEvmAddress,
  resolveAgentKey,
  resolveExecIdempotencyKey,
  throwWithIdempotencyKey,
} from "../commands/shared.js";
import {
  FARCASTER_CAST_HASH_HEX_PATTERN,
  FARCASTER_MAX_CAST_TEXT_BYTES,
  FARCASTER_USAGE,
  POST_RECEIPT_VERSION,
  NEYNAR_HUB_CAST_BY_ID_URL,
  NEYNAR_HUB_SUBMIT_URL,
  SIGNER_FILE_NAME,
  VERIFY_POLL_MAX_ATTEMPTS,
  X402_VALUE_USDC_DISPLAY,
} from "./constants.js";
import { buildCastMessage, sanitizeHubErrorText, submitCastToHub, verifyCastInclusion } from "./hub-client.js";
import {
  assertPostReceiptMatch,
  buildPostResultPayload,
  decodeMessageBytesBase64,
  encodeMessageBytesBase64,
  readPostReceipt,
  resolvePostReceiptPath,
  writePostReceipt,
} from "./receipt.js";
import {
  ensurePayerConfigForPost,
  readStoredX402PayerConfig,
  resolveLocalPayerPrivateKey,
  resolvePostPayer,
} from "./payer.js";
import {
  executeLocalFarcasterSignup,
  LocalFarcasterAlreadyRegisteredError,
} from "./local-signup.js";
import {
  generateEd25519PrivateKey,
  normalizeDirectoryOption,
  normalizeSignerFileOption,
  parseExtraStorage,
  parseFidString,
  readStoredSigner,
  resolveSignerFilePath,
  resolveSignerOutputDirectory,
  saveSignerSecret,
} from "./signer.js";
import type {
  FarcasterPostReceiptResult,
  FarcasterPostVerifyResult,
  FarcasterReplyTarget,
  HexString,
  X402PaymentHeader,
  X402VerifyMode,
} from "./types.js";

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

function resolveVerifyMode(input: string | undefined): X402VerifyMode {
  if (input === undefined) return "none";
  const normalized = input.trim().toLowerCase();
  if (normalized === "none" || normalized === "false") return "none";
  if (normalized === "once" || normalized === "true") return "once";
  if (normalized === "poll") return "poll";
  throw new Error("--verify must be one of: none, once, poll");
}

function withSignerInfo(
  payload: Record<string, unknown>,
  signerPublicKey: `0x${string}`,
  saved: boolean
) {
  return {
    ...payload,
    signer: {
      publicKey: signerPublicKey,
      saved,
      file: SIGNER_FILE_NAME,
    },
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

async function buildCastWithIdempotency(params: {
  fid: number;
  text: string;
  signerPrivateKeyHex: HexString;
  replyTo: FarcasterReplyTarget | undefined;
  idempotencyKey: string;
}): Promise<{ messageBytes: Uint8Array; castHashHex: HexString }> {
  try {
    return await buildCastMessage({
      fid: params.fid,
      text: params.text,
      signerPrivateKeyHex: params.signerPrivateKeyHex,
      replyTo: params.replyTo,
    });
  } catch (error) {
    throwWithIdempotencyKey(error, params.idempotencyKey);
  }
}

export interface FarcasterSignupCommandInput {
  agent?: string;
  recovery?: string;
  extraStorage?: string;
  outDir?: string;
}

export interface FarcasterPostCommandInput {
  agent?: string;
  text?: string;
  fid?: string;
  replyTo?: string;
  signerFile?: string;
  idempotencyKey?: string;
  verify?: string;
  dryRun?: boolean;
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
  let walletConfig: ReturnType<typeof readStoredX402PayerConfig> = null;
  try {
    walletConfig = readStoredX402PayerConfig({
      deps,
      agentKey,
    });
  } catch {
    // Signup can proceed without wallet metadata; local mode is an optimization path.
    walletConfig = null;
  }

  if (walletConfig?.mode === "local") {
    const privateKeyHex = resolveLocalPayerPrivateKey({
      deps,
      currentConfig: current,
      payerConfig: walletConfig,
    });
    let localResult: Awaited<ReturnType<typeof executeLocalFarcasterSignup>>;
    try {
      localResult = await executeLocalFarcasterSignup({
        deps,
        privateKeyHex,
        signerPublicKey,
        ...(recovery ? { recoveryAddress: recovery } : {}),
        ...(extraStorage ? { extraStorage } : {}),
      });
    } catch (error) {
      if (error instanceof LocalFarcasterAlreadyRegisteredError) {
        throw new Error(
          `Farcaster account already exists for this agent wallet (fid=${error.fid}, custodyAddress=${error.custodyAddress}). Use a different --agent key for a new Farcaster signup.`
        );
      }
      throw error;
    }
    if (localResult.status === "complete") {
      saveSignerSecret({
        deps,
        config: current,
        agentKey,
        outputDirectory,
        signerPublicKey,
        signerPrivateKey,
        result: localResult,
      });
      return withSignerInfo(
        buildFarcasterSignupResponse(localResult),
        signerPublicKey,
        true
      );
    }
    return withSignerInfo(
      buildFarcasterSignupResponse(localResult),
      signerPublicKey,
      false
    );
  }

  let response: unknown;
  try {
    response = await apiPost(deps, "/api/cli/farcaster/signup", {
      signerPublicKey,
      ...(recovery ? { recoveryAddress: recovery } : {}),
      ...(extraStorage ? { extraStorage } : {}),
    });
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 409) {
      let fid: string | null = null;
      let custodyAddress: string | null = null;
      try {
        const response = validateFarcasterSignupAlreadyRegisteredErrorResponse(error.payload);
        fid = response.details.fid;
        custodyAddress = response.details.custodyAddress;
      } catch {
        // Keep the CLI error readable even if the backend returns a malformed 409 payload.
      }
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

  const payload = validateFarcasterSignupResponse(response);
  if (payload.result.status === "complete") {
    saveSignerSecret({
      deps,
      config: current,
      agentKey,
      outputDirectory,
      signerPublicKey,
      signerPrivateKey,
      result: payload.result,
    });
    return withSignerInfo(payload, signerPublicKey, true);
  }

  return withSignerInfo(payload, signerPublicKey, false);
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

  if (input.dryRun === true) {
    const cast = await buildCastWithIdempotency({
      fid,
      text,
      signerPrivateKeyHex: signer.privateKeyHex,
      replyTo,
      idempotencyKey,
    });

    return {
      ok: true,
      dryRun: true,
      idempotencyKey,
      request: {
        kind: "farcaster.post",
        agentKey,
        fid,
        text,
        castHashHex: cast.castHashHex,
        signerFilePath,
        verifyMode,
        ...(replyTo ? { replyTo } : {}),
        requests: [
          {
            method: "POST",
            url: NEYNAR_HUB_SUBMIT_URL,
            bodyType: "application/octet-stream",
            requiresX402Payment: true,
          },
          ...(verify
            ? [
                {
                  method: "GET",
                  url: `${NEYNAR_HUB_CAST_BY_ID_URL}?fid=${fid}&hash=${cast.castHashHex}`,
                  requiresX402Payment: "conditional_http_402",
                },
              ]
            : []),
        ],
      },
    };
  }

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
    const cast = await buildCastWithIdempotency({
      fid,
      text,
      signerPrivateKeyHex: signer.privateKeyHex,
      replyTo,
      idempotencyKey,
    });
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
