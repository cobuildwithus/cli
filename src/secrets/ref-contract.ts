import type { CliConfig, SecretRef, SecretRefSource } from "../types.js";

const FILE_SECRET_REF_SEGMENT_PATTERN = /^(?:[^~]|~0|~1)*$/;

export const DEFAULT_SECRET_PROVIDER_ALIAS = "default";
export const SINGLE_VALUE_FILE_REF_ID = "value";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isSecretRef(value: unknown): value is SecretRef {
  if (!isRecord(value)) {
    return false;
  }
  if (Object.keys(value).length !== 3) {
    return false;
  }
  return (
    (value.source === "env" || value.source === "file" || value.source === "exec") &&
    typeof value.provider === "string" &&
    value.provider.trim().length > 0 &&
    typeof value.id === "string" &&
    value.id.trim().length > 0
  );
}

export function secretRefKey(ref: SecretRef): string {
  return `${ref.source}:${ref.provider}:${ref.id}`;
}

export function resolveDefaultSecretProviderAlias(config: CliConfig, source: SecretRefSource): string {
  const configured =
    source === "env"
      ? config.secrets?.defaults?.env
      : source === "file"
        ? config.secrets?.defaults?.file
        : config.secrets?.defaults?.exec;
  if (configured?.trim()) {
    return configured.trim();
  }

  if (config.secrets?.providers) {
    for (const [providerName, provider] of Object.entries(config.secrets.providers)) {
      if (provider?.source === source) {
        return providerName;
      }
    }
  }

  return DEFAULT_SECRET_PROVIDER_ALIAS;
}

function resolveStructuredFileProviderAlias(config: CliConfig): string {
  const preferredAlias = resolveDefaultSecretProviderAlias(config, "file");
  const preferredProvider = config.secrets?.providers?.[preferredAlias];
  if (preferredProvider?.source === "file" && preferredProvider.mode === "singleValue") {
    const fallbackProvider = config.secrets?.providers?.[DEFAULT_SECRET_PROVIDER_ALIAS];
    if (
      preferredAlias !== DEFAULT_SECRET_PROVIDER_ALIAS &&
      fallbackProvider?.source === "file" &&
      fallbackProvider.mode !== "singleValue"
    ) {
      return DEFAULT_SECRET_PROVIDER_ALIAS;
    }

    throw new Error(
      `Secret provider "${preferredAlias}" uses mode "singleValue" and cannot store structured SecretRef ids. Configure a JSON file provider for auth/signer refs.`
    );
  }
  return preferredAlias;
}

export function isValidFileSecretRefId(value: string): boolean {
  if (value === SINGLE_VALUE_FILE_REF_ID) {
    return true;
  }
  if (!value.startsWith("/")) {
    return false;
  }
  return value
    .slice(1)
    .split("/")
    .every((segment) => FILE_SECRET_REF_SEGMENT_PATTERN.test(segment));
}

function encodeJsonPointerSegment(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function decodeJsonPointerSegment(value: string): string {
  return value.replaceAll("~1", "/").replaceAll("~0", "~");
}

export function toFileSecretRefId(secretKey: string): string {
  return `/${encodeJsonPointerSegment(secretKey)}`;
}

export function fromFileSecretRefId(secretRefId: string): string | null {
  if (!isValidFileSecretRefId(secretRefId) || !secretRefId.startsWith("/")) {
    return null;
  }
  return decodeJsonPointerSegment(secretRefId.slice(1));
}

function toOriginIdentifier(interfaceUrl: string | undefined): string {
  if (!interfaceUrl || interfaceUrl.trim().length === 0) {
    return "default";
  }
  try {
    return new URL(interfaceUrl).origin;
  } catch {
    return "default";
  }
}

export function buildRefreshSecretKey(interfaceUrl: string | undefined): string {
  return `oauth_refresh:${toOriginIdentifier(interfaceUrl)}`;
}

export function buildRefreshTokenRef(config: CliConfig, interfaceUrl: string | undefined): SecretRef {
  return {
    source: "file",
    provider: resolveStructuredFileProviderAlias(config),
    id: toFileSecretRefId(buildRefreshSecretKey(interfaceUrl)),
  };
}

export function buildFarcasterSignerSecretKey(agentKey: string): string {
  return `farcaster:ed25519:${agentKey}:signer`;
}

export function buildFarcasterSignerRef(config: CliConfig, agentKey: string): SecretRef {
  return {
    source: "file",
    provider: resolveStructuredFileProviderAlias(config),
    id: toFileSecretRefId(buildFarcasterSignerSecretKey(agentKey)),
  };
}

export function buildWalletPayerSecretKey(agentKey: string): string {
  return `wallet:payer:${agentKey}`;
}

export function buildWalletPayerRef(config: CliConfig, agentKey: string): SecretRef {
  return {
    source: "file",
    provider: resolveStructuredFileProviderAlias(config),
    id: toFileSecretRefId(buildWalletPayerSecretKey(agentKey)),
  };
}
