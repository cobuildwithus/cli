import { describe, expect, it } from "vitest";
import {
  parseCliWalletAddressCandidates,
  parseCliWalletAddressForSetupSummary,
  parseOAuthErrorPayload,
  parseOAuthTokenPayload,
  parseSetupPayerMetadata,
  parseToolCatalogEntryName,
  parseToolExecutionResult,
  parseToolsCatalogEntries,
} from "../src/api-response-schemas.js";

describe("api response schemas", () => {
  it("parses oauth token payload and floors expires_in", () => {
    expect(
      parseOAuthTokenPayload({
        access_token: "access",
        refresh_token: "refresh",
        expires_in: 123.9,
        scope: "tools:read",
        session_id: "session-1",
      })
    ).toEqual({
      accessToken: "access",
      refreshToken: "refresh",
      expiresIn: 123,
      scope: "tools:read",
      sessionId: "session-1",
    });
  });

  it("uses oauth token defaults for optional string fields", () => {
    expect(
      parseOAuthTokenPayload({
        access_token: "access",
        refresh_token: "refresh",
        expires_in: 1,
        scope: 123,
        session_id: false,
      })
    ).toEqual({
      accessToken: "access",
      refreshToken: "refresh",
      expiresIn: 1,
      scope: "",
      sessionId: null,
    });
  });

  it("rejects invalid oauth token payloads", () => {
    expect(() => parseOAuthTokenPayload(null)).toThrow("OAuth token response was not valid JSON.");
    expect(() =>
      parseOAuthTokenPayload({
        refresh_token: "refresh",
        expires_in: 1,
      })
    ).toThrow("OAuth token response did not include access_token.");
    expect(() =>
      parseOAuthTokenPayload({
        access_token: "access",
        expires_in: 1,
      })
    ).toThrow("OAuth token response did not include refresh_token.");
    expect(() =>
      parseOAuthTokenPayload({
        access_token: "access",
        refresh_token: "refresh",
        expires_in: 0,
      })
    ).toThrow("OAuth token response did not include a valid expires_in.");
  });

  it("parses oauth error payloads", () => {
    expect(
      parseOAuthErrorPayload({
        error: "invalid_grant",
        error_description: "expired",
      })
    ).toEqual({
      oauthError: "invalid_grant",
      oauthDescription: "expired",
    });

    expect(parseOAuthErrorPayload("not-an-object")).toEqual({
      oauthError: null,
      oauthDescription: null,
    });
  });

  it("normalizes oauth error payload strings and drops blank values", () => {
    expect(
      parseOAuthErrorPayload({
        error: "  invalid_grant  ",
        error_description: "   ",
      })
    ).toEqual({
      oauthError: "invalid_grant",
      oauthDescription: null,
    });
  });

  it("parses setup wallet address summary and candidates", () => {
    expect(
      parseCliWalletAddressForSetupSummary({
        wallet: { address: "0xabc" },
      })
    ).toBe("0xabc");
    expect(parseCliWalletAddressForSetupSummary("bad-shape")).toBeNull();

    expect(
      parseCliWalletAddressCandidates({
        result: { ownerAccountAddress: "0x1", wallet: { address: "0x2" } },
        ownerAccountAddress: "0x3",
        wallet: { address: "0x4" },
      })
    ).toEqual({
      resultOwnerAccountAddress: "0x1",
      resultWalletAddress: "0x2",
      ownerAccountAddress: "0x3",
      walletAddress: "0x4",
    });
    expect(parseCliWalletAddressCandidates("bad-shape")).toBeNull();
  });

  it("parses tools catalog entries across envelope shapes", () => {
    const arrayPayload = [{ name: "a" }];
    expect(parseToolsCatalogEntries(arrayPayload)).toBe(arrayPayload);

    expect(parseToolsCatalogEntries({ tools: [{ name: "tool" }] })).toEqual([{ name: "tool" }]);
    expect(parseToolsCatalogEntries({ data: [{ id: "tool-1" }] })).toEqual([{ id: "tool-1" }]);
    expect(parseToolsCatalogEntries({ results: [{ toolName: "tool_2" }] })).toEqual([
      { toolName: "tool_2" },
    ]);
    expect(parseToolsCatalogEntries("bad-shape")).toEqual([]);
  });

  it("parses tool catalog entry names across known keys", () => {
    expect(parseToolCatalogEntryName({ name: "name-value" })).toBe("name-value");
    expect(parseToolCatalogEntryName({ toolName: "tool-name" })).toBe("tool-name");
    expect(parseToolCatalogEntryName({ id: "id-value" })).toBe("id-value");
    expect(parseToolCatalogEntryName({})).toBeNull();
    expect(parseToolCatalogEntryName("bad-shape")).toBeNull();
  });

  it("parses tool execution result envelopes", () => {
    const arrayPayload = [{ id: 1 }];
    expect(parseToolExecutionResult(arrayPayload)).toBe(arrayPayload);
    expect(parseToolExecutionResult("raw")).toBe("raw");
    expect(parseToolExecutionResult({ result: { ok: true } })).toEqual({ ok: true });
    expect(parseToolExecutionResult({ execution: { output: { nested: true } } })).toEqual({
      nested: true,
    });
    expect(parseToolExecutionResult({ toolExecution: { data: { nested: "toolExecution" } } })).toEqual({
      nested: "toolExecution",
    });

    const passthroughPayload = { foo: "bar" };
    expect(parseToolExecutionResult(passthroughPayload)).toBe(passthroughPayload);

    const nestedWithoutKnownKeys = {
      execution: { ignored: true },
      toolExecution: { stillIgnored: true },
    };
    expect(parseToolExecutionResult(nestedWithoutKnownKeys)).toBe(nestedWithoutKnownKeys);
  });

  it("parses setup payer metadata and defaults", () => {
    expect(
      parseSetupPayerMetadata({
        payer: {
          mode: "hosted",
          payerAddress: "0xabc",
          network: "base",
          token: "usdc",
          costPerPaidCallMicroUsdc: "2000",
        },
      })
    ).toEqual({
      mode: "hosted",
      payerAddress: "0xabc",
      network: "base",
      token: "usdc",
      costPerPaidCallMicroUsdc: "2000",
    });

    expect(
      parseSetupPayerMetadata({
        payer: {
          mode: "local",
        },
      })
    ).toEqual({
      mode: "local",
      payerAddress: null,
      network: "base",
      token: "usdc",
      costPerPaidCallMicroUsdc: "1000",
    });
  });

  it("rejects invalid setup payer metadata payloads", () => {
    expect(() => parseSetupPayerMetadata(null)).toThrow("Payer setup did not return payer metadata.");
    expect(() => parseSetupPayerMetadata({ payer: "bad-shape" })).toThrow(
      "Payer setup did not return payer metadata."
    );
    expect(() => parseSetupPayerMetadata({ payer: {} })).toThrow(
      "Payer setup returned an invalid mode."
    );
  });
});
