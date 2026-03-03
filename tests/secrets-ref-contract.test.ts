import { describe, expect, it } from "vitest";
import type { CliConfig, SecretRef } from "../src/types.js";
import {
  DEFAULT_SECRET_PROVIDER_ALIAS,
  buildWalletPayerRef,
  buildWalletPayerSecretKey,
  SINGLE_VALUE_FILE_REF_ID,
  buildFarcasterSignerRef,
  buildFarcasterSignerSecretKey,
  buildPatSecretKey,
  buildPatTokenRef,
  fromFileSecretRefId,
  isSecretRef,
  isValidFileSecretRefId,
  resolveDefaultSecretProviderAlias,
  secretRefKey,
  toFileSecretRefId,
} from "../src/secrets/ref-contract.js";

describe("secrets ref-contract", () => {
  it("validates SecretRef objects strictly", () => {
    const valid: SecretRef = {
      source: "file",
      provider: "default",
      id: "/token",
    };

    expect(isSecretRef(valid)).toBe(true);
    expect(
      isSecretRef({
        ...valid,
        extra: true,
      })
    ).toBe(false);
    expect(isSecretRef({ source: "keychain", provider: "default", id: "/token" })).toBe(false);
    expect(isSecretRef({ source: "file", provider: "", id: "/token" })).toBe(false);
    expect(isSecretRef({ source: "file", provider: "default", id: "   " })).toBe(false);
    expect(isSecretRef(null)).toBe(false);
  });

  it("formats stable ref keys", () => {
    expect(secretRefKey({ source: "env", provider: "prod", id: "COBUILD_PAT" })).toBe(
      "env:prod:COBUILD_PAT"
    );
  });

  it("resolves default provider aliases by defaults, providers, or fallback", () => {
    const withDefaults: CliConfig = {
      secrets: {
        defaults: {
          env: " env-provider ",
        },
      },
    };
    expect(resolveDefaultSecretProviderAlias(withDefaults, "env")).toBe("env-provider");

    const fromProviders: CliConfig = {
      secrets: {
        providers: {
          runtimeEnv: { source: "env" },
          fileStore: { source: "file", path: "/tmp/secrets.json" },
        },
      },
    };
    expect(resolveDefaultSecretProviderAlias(fromProviders, "env")).toBe("runtimeEnv");

    expect(resolveDefaultSecretProviderAlias({}, "exec")).toBe(DEFAULT_SECRET_PROVIDER_ALIAS);
  });

  it("validates JSON pointer ids for file-backed refs", () => {
    expect(isValidFileSecretRefId(SINGLE_VALUE_FILE_REF_ID)).toBe(true);
    expect(isValidFileSecretRefId("/token/path")).toBe(true);
    expect(isValidFileSecretRefId("/a~1b/~0tilde")).toBe(true);
    expect(isValidFileSecretRefId("token/path")).toBe(false);
    expect(isValidFileSecretRefId("/bad~2escape")).toBe(false);
  });

  it("round-trips file ref ids and rejects invalid ids on decode", () => {
    const id = toFileSecretRefId("pat:https://api.example");
    expect(id).toBe("/pat:https:~1~1api.example");
    expect(fromFileSecretRefId(id)).toBe("pat:https://api.example");
    expect(fromFileSecretRefId("not-a-pointer")).toBeNull();
  });

  it("builds deterministic PAT and Farcaster key/ref contracts", () => {
    const config: CliConfig = {
      secrets: {
        defaults: {
          file: "vault",
        },
      },
    };

    expect(buildPatSecretKey("https://api.example/path")).toBe("pat:https://api.example");
    expect(buildPatSecretKey("not-a-url")).toBe("pat:default");
    expect(buildPatSecretKey(undefined)).toBe("pat:default");
    expect(buildPatTokenRef(config, "https://api.example")).toEqual({
      source: "file",
      provider: "vault",
      id: "/pat:https:~1~1api.example",
    });

    expect(buildFarcasterSignerSecretKey("agent-one")).toBe("farcaster:ed25519:agent-one:signer");
    expect(buildFarcasterSignerRef(config, "agent-one")).toEqual({
      source: "file",
      provider: "vault",
      id: "/farcaster:ed25519:agent-one:signer",
    });
    expect(buildWalletPayerSecretKey("agent-one")).toBe("wallet:payer:agent-one");
    expect(buildWalletPayerRef(config, "agent-one")).toEqual({
      source: "file",
      provider: "vault",
      id: "/wallet:payer:agent-one",
    });
  });

  it("falls back to default JSON provider when selected file default is singleValue", () => {
    const config: CliConfig = {
      secrets: {
        providers: {
          default: {
            source: "file",
            path: "/tmp/secrets.json",
            mode: "json",
          },
          single: {
            source: "file",
            path: "/tmp/token.txt",
            mode: "singleValue",
          },
        },
        defaults: {
          file: "single",
        },
      },
    };

    expect(buildPatTokenRef(config, "https://api.example")).toEqual({
      source: "file",
      provider: "default",
      id: "/pat:https:~1~1api.example",
    });
    expect(buildFarcasterSignerRef(config, "agent-one")).toEqual({
      source: "file",
      provider: "default",
      id: "/farcaster:ed25519:agent-one:signer",
    });
    expect(buildWalletPayerRef(config, "agent-one")).toEqual({
      source: "file",
      provider: "default",
      id: "/wallet:payer:agent-one",
    });
  });

  it("rejects structured refs when only singleValue file providers are configured", () => {
    const config: CliConfig = {
      secrets: {
        providers: {
          default: {
            source: "file",
            path: "/tmp/token.txt",
            mode: "singleValue",
          },
        },
        defaults: {
          file: "default",
        },
      },
    };

    expect(() => buildPatTokenRef(config, "https://api.example")).toThrow(
      'Secret provider "default" uses mode "singleValue" and cannot store structured SecretRef ids.'
    );
    expect(() => buildFarcasterSignerRef(config, "agent-one")).toThrow(
      'Secret provider "default" uses mode "singleValue" and cannot store structured SecretRef ids.'
    );
    expect(() => buildWalletPayerRef(config, "agent-one")).toThrow(
      'Secret provider "default" uses mode "singleValue" and cannot store structured SecretRef ids.'
    );
  });
});
