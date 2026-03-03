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

export const X402_VERSION = 1;
export const X402_SCHEME = "exact";
export const X402_NETWORK = "base";
export const X402_TOKEN_SYMBOL = "usdc";
export const X402_USDC_CONTRACT = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
export const X402_PAY_TO_ADDRESS = "0xA6a8736f18f383f1cc2d938576933E5eA7Df01A1".toLowerCase();
export const X402_VALUE_MICRO_USDC = "1000";
export const X402_VALUE_USDC_DISPLAY = "0.001";

export const BASE_CHAIN_ID = 8453;
export const USDC_EIP712_DOMAIN_NAME = "USD Coin";
export const USDC_EIP712_DOMAIN_VERSION = "2";
export const X402_AUTH_VALID_AFTER = "0";
export const X402_AUTH_TTL_SECONDS = 300;
