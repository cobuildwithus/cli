import { describe, expect, it } from "vitest";
import { UUID_V4_REGEX } from "../src/uuid.js";

describe("uuid regex", () => {
  it("matches valid v4 UUIDs", () => {
    expect(UUID_V4_REGEX.test("f47ac10b-58cc-4372-a567-0e02b2c3d479")).toBe(true);
    expect(UUID_V4_REGEX.test("F47AC10B-58CC-4372-A567-0E02B2C3D479")).toBe(true);
  });

  it("rejects non-v4 UUIDs and malformed values", () => {
    expect(UUID_V4_REGEX.test("f47ac10b-58cc-1372-a567-0e02b2c3d479")).toBe(false);
    expect(UUID_V4_REGEX.test("not-a-uuid")).toBe(false);
    expect(UUID_V4_REGEX.test("f47ac10b58cc4372a5670e02b2c3d479")).toBe(false);
  });
});
