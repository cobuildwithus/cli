import { describe, expect, it } from "vitest";
import {
  buildIdempotencyRequestHeaders,
  IDEMPOTENCY_DEPRECATED_HEADER,
  IDEMPOTENCY_HEADER_NAMES,
  IDEMPOTENCY_KEY_EXAMPLE,
  IDEMPOTENCY_KEY_VALIDATION_ERROR,
  IDEMPOTENCY_PRIMARY_HEADER,
  isIdempotencyKey,
} from "../src/idempotency-contract.js";

describe("idempotency-contract", () => {
  it("defines canonical and deprecated idempotency headers", () => {
    expect(IDEMPOTENCY_HEADER_NAMES).toEqual([
      IDEMPOTENCY_PRIMARY_HEADER,
      IDEMPOTENCY_DEPRECATED_HEADER,
    ]);
    expect(IDEMPOTENCY_PRIMARY_HEADER).toBe("Idempotency-Key");
    expect(IDEMPOTENCY_DEPRECATED_HEADER).toBe("X-Idempotency-Key");
  });

  it("builds both idempotency headers with the same key", () => {
    const key = "8e03978e-40d5-43e8-bc93-6894a57f9324";
    expect(buildIdempotencyRequestHeaders(key)).toEqual({
      "Idempotency-Key": key,
      "X-Idempotency-Key": key,
    });
  });

  it("validates UUID v4 idempotency keys", () => {
    expect(isIdempotencyKey("8e03978e-40d5-43e8-bc93-6894a57f9324")).toBe(true);
    expect(isIdempotencyKey("8E03978E-40D5-43E8-BC93-6894A57F9324")).toBe(true);
    expect(isIdempotencyKey("f47ac10b-58cc-11cf-a447-001122334455")).toBe(false);
    expect(isIdempotencyKey("not-a-uuid")).toBe(false);
  });

  it("exports an actionable validation error with a UUID v4 example", () => {
    expect(IDEMPOTENCY_KEY_EXAMPLE).toBe("8e03978e-40d5-43e8-bc93-6894a57f9324");
    expect(IDEMPOTENCY_KEY_VALIDATION_ERROR).toBe(
      `Idempotency key must be a UUID v4 (e.g. ${IDEMPOTENCY_KEY_EXAMPLE})`
    );
  });
});
