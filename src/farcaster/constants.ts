export {
  BASE_CHAIN_ID,
  USDC_EIP712_DOMAIN_NAME,
  X402_AUTH_TTL_SECONDS,
  X402_AUTH_VALID_AFTER,
  USDC_EIP712_DOMAIN_VERSION,
  X402_NETWORK,
  X402_PAY_TO_ADDRESS,
  X402_SCHEME,
  X402_TOKEN_SYMBOL,
  X402_USDC_CONTRACT,
  X402_VALUE_MICRO_USDC,
  X402_VALUE_USDC_DISPLAY,
  X402_VERSION,
} from "@cobuild/wire";

export const FARCASTER_USAGE = `Usage:
  cli farcaster signup [--agent <key>] [--recovery <0x...>] [--extra-storage <n>] [--out-dir <path>]
  cli farcaster post --text <text> [--fid <n>] [--reply-to <parent-fid:0x-parent-hash>] [--signer-file <path>] [--idempotency-key <key>] [--verify[=once|poll]|--verify=none]`;

export const SIGNER_FILE_NAME = "ed25519-signer.json";
export const PAYER_FILE_NAME = "payer.json";

export const NEYNAR_HUB_SUBMIT_URL = "https://hub-api.neynar.com/v1/submitMessage";
export const NEYNAR_HUB_CAST_BY_ID_URL = "https://hub-api.neynar.com/v1/castById";

export const HUB_PAYMENT_RETRYABLE_STATUS = 402;
export const HUB_SUBMIT_MAX_ATTEMPTS = 2;
export const HUB_SUBMIT_TIMEOUT_MS = 30_000;
export const HUB_VERIFY_TIMEOUT_MS = 10_000;
export const VERIFY_DELAY_MS = 1_200;
export const VERIFY_POLL_MAX_ATTEMPTS = 5;

export const FARCASTER_MAX_CAST_TEXT_BYTES = 320;
export const FARCASTER_CAST_HASH_HEX_PATTERN = /^0x[0-9a-fA-F]{40}$/;

export const POST_RECEIPT_VERSION = 1;
