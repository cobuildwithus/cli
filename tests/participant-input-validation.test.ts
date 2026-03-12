import { describe, expect, it } from "vitest";
import {
  requireParticipantBigintLike,
  requireParticipantString,
} from "../src/commands/participant-input-validation.js";

describe("participant input validation", () => {
  it("trims required participant strings", () => {
    expect(requireParticipantString("  value  ", "Usage: test", "--field")).toBe("value");
  });

  it("rejects missing or blank participant strings", () => {
    expect(() => requireParticipantString(undefined, "Usage: test", "--field")).toThrow(
      "Usage: test\n--field is required."
    );
    expect(() => requireParticipantString("   ", "Usage: test", "--field")).toThrow(
      "Usage: test\n--field is required."
    );
  });

  it("trims bigint-like string inputs", () => {
    expect(requireParticipantBigintLike(" 42 ", "Usage: test", "--amount")).toBe("42");
    expect(requireParticipantBigintLike(42n, "Usage: test", "--amount")).toBe(42n);
  });

  it("rejects missing or blank bigint-like inputs", () => {
    expect(() => requireParticipantBigintLike(undefined, "Usage: test", "--amount")).toThrow(
      "Usage: test\n--amount is required."
    );
    expect(() => requireParticipantBigintLike("   ", "Usage: test", "--amount")).toThrow(
      "Usage: test\n--amount is required."
    );
  });
});
