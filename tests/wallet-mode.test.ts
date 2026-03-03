import { describe, expect, it } from "vitest";
import {
  normalizeOptionalWalletInitMode,
  normalizeWalletInitMode,
  parseWalletModePromptAnswer,
} from "../src/wallet/mode.js";

describe("wallet mode helpers", () => {
  it("normalizes supported mode values", () => {
    expect(normalizeWalletInitMode("hosted", "--mode")).toBe("hosted");
    expect(normalizeWalletInitMode(" LOCAL-GENERATE ", "--mode")).toBe("local-generate");
    expect(normalizeWalletInitMode("local-key", "--mode")).toBe("local-key");
  });

  it("throws option-scoped errors for unsupported mode values", () => {
    expect(() => normalizeWalletInitMode("nope", "--mode")).toThrow(
      "--mode must be one of: hosted, local-generate, local-key"
    );
  });

  it("supports optional parsing with undefined passthrough", () => {
    expect(normalizeOptionalWalletInitMode(undefined, "--wallet-mode")).toBeUndefined();
    expect(normalizeOptionalWalletInitMode("hosted", "--wallet-mode")).toBe("hosted");
  });

  it("parses interactive prompt answers from numeric or literal values", () => {
    expect(parseWalletModePromptAnswer("1")).toBe("hosted");
    expect(parseWalletModePromptAnswer("2")).toBe("local-generate");
    expect(parseWalletModePromptAnswer("3")).toBe("local-key");
    expect(parseWalletModePromptAnswer("hosted")).toBe("hosted");
    expect(parseWalletModePromptAnswer(" local-key ")).toBe("local-key");
    expect(parseWalletModePromptAnswer("invalid")).toBeNull();
  });
});
