import { UUID_V4_REGEX } from "./uuid.js";

export const IDEMPOTENCY_PRIMARY_HEADER = "Idempotency-Key";
export const IDEMPOTENCY_DEPRECATED_HEADER = "X-Idempotency-Key";

export const IDEMPOTENCY_HEADER_NAMES = [
  IDEMPOTENCY_PRIMARY_HEADER,
  IDEMPOTENCY_DEPRECATED_HEADER,
] as const;

export const IDEMPOTENCY_KEY_EXAMPLE = "8e03978e-40d5-43e8-bc93-6894a57f9324";
export const IDEMPOTENCY_KEY_PATTERN = UUID_V4_REGEX;
export const IDEMPOTENCY_KEY_VALIDATION_ERROR = `Idempotency key must be a UUID v4 (e.g. ${IDEMPOTENCY_KEY_EXAMPLE})`;

export function isIdempotencyKey(value: string): boolean {
  return IDEMPOTENCY_KEY_PATTERN.test(value);
}

export function buildIdempotencyRequestHeaders(idempotencyKey: string): Record<string, string> {
  return {
    [IDEMPOTENCY_PRIMARY_HEADER]: idempotencyKey,
    [IDEMPOTENCY_DEPRECATED_HEADER]: idempotencyKey,
  };
}
