import { z } from "incur";

const NonEmptyStringSchema = z.string().refine((value) => value.trim().length > 0);

const OAuthTokenPayloadSchema = z
  .object({
    access_token: z.unknown().optional(),
    refresh_token: z.unknown().optional(),
    expires_in: z.unknown().optional(),
    scope: z.unknown().optional(),
    session_id: z.unknown().optional(),
  })
  .passthrough();

const OAuthTokenErrorPayloadSchema = z
  .object({
    error: z.unknown().optional(),
    error_description: z.unknown().optional(),
  })
  .passthrough();

const LooseObjectSchema = z.object({}).passthrough();

function asLooseRecord(value: unknown): Record<string, unknown> | null {
  const parsed = LooseObjectSchema.safeParse(value);
  if (!parsed.success) {
    return null;
  }
  return parsed.data;
}

function parseStringValue(value: unknown): string | null {
  const parsed = z.string().safeParse(value);
  if (!parsed.success) {
    return null;
  }
  return parsed.data;
}

function parseStringPath(payload: unknown, path: string[]): string | null {
  let current: unknown = payload;
  for (const key of path) {
    const record = asLooseRecord(current);
    if (!record) {
      return null;
    }
    current = record[key];
  }
  return parseStringValue(current);
}

export function parseOAuthTokenPayload(payload: unknown): {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scope: string;
  sessionId: string | null;
} {
  const parsed = OAuthTokenPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error("OAuth token response was not valid JSON.");
  }

  const { access_token, refresh_token, expires_in, scope, session_id } = parsed.data;

  const accessToken = NonEmptyStringSchema.safeParse(access_token);
  if (!accessToken.success) {
    throw new Error("OAuth token response did not include access_token.");
  }
  const refreshToken = NonEmptyStringSchema.safeParse(refresh_token);
  if (!refreshToken.success) {
    throw new Error("OAuth token response did not include refresh_token.");
  }
  const expiresInParse = z.number().finite().positive().safeParse(expires_in);
  if (!expiresInParse.success) {
    throw new Error("OAuth token response did not include a valid expires_in.");
  }

  const scopeValue = z.string().safeParse(scope);
  const sessionIdValue = z.string().safeParse(session_id);

  return {
    accessToken: accessToken.data,
    refreshToken: refreshToken.data,
    expiresIn: Math.floor(expiresInParse.data),
    scope: scopeValue.success ? scopeValue.data : "",
    sessionId: sessionIdValue.success ? sessionIdValue.data : null,
  };
}

export function parseOAuthErrorPayload(payload: unknown): {
  oauthError: string | null;
  oauthDescription: string | null;
} {
  const parsed = OAuthTokenErrorPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      oauthError: null,
      oauthDescription: null,
    };
  }

  const oauthError = NonEmptyStringSchema.safeParse(parsed.data.error);
  const oauthDescription = NonEmptyStringSchema.safeParse(parsed.data.error_description);

  return {
    oauthError: oauthError.success ? oauthError.data : null,
    oauthDescription: oauthDescription.success ? oauthDescription.data : null,
  };
}

export function parseCliWalletAddressForSetupSummary(payload: unknown): string | null {
  return parseStringPath(payload, ["wallet", "address"]);
}

export function parseCliWalletAddressCandidates(payload: unknown): {
  resultOwnerAccountAddress: string | null;
  resultWalletAddress: string | null;
  ownerAccountAddress: string | null;
  walletAddress: string | null;
} | null {
  const root = asLooseRecord(payload);
  if (!root) {
    return null;
  }

  return {
    resultOwnerAccountAddress: parseStringPath(root, ["result", "ownerAccountAddress"]),
    resultWalletAddress: parseStringPath(root, ["result", "wallet", "address"]),
    ownerAccountAddress: parseStringValue(root.ownerAccountAddress),
    walletAddress: parseStringPath(root, ["wallet", "address"]),
  };
}

export function parseToolsCatalogEntries(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  const record = asLooseRecord(payload);
  if (!record) {
    return [];
  }

  for (const key of ["tools", "data", "results"]) {
    const candidate = record[key];
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  return [];
}

export function parseToolCatalogEntryName(payload: unknown): string | null {
  const record = asLooseRecord(payload);
  if (!record) {
    return null;
  }

  for (const key of ["name", "toolName", "id"]) {
    const candidate = NonEmptyStringSchema.safeParse(record[key]);
    if (candidate.success) {
      return candidate.data;
    }
  }

  return null;
}

function extractExecutionValue(record: Record<string, unknown>): unknown | undefined {
  for (const key of ["result", "output", "data", "value", "toolResult"]) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      return record[key];
    }
  }
  return undefined;
}

export function parseToolExecutionResult(payload: unknown): unknown {
  if (Array.isArray(payload)) {
    return payload;
  }

  const record = asLooseRecord(payload);
  if (!record) {
    return payload;
  }

  const rootValue = extractExecutionValue(record);
  if (rootValue !== undefined) {
    return rootValue;
  }

  const execution = asLooseRecord(record.execution);
  if (execution) {
    const nestedValue = extractExecutionValue(execution);
    if (nestedValue !== undefined) {
      return nestedValue;
    }
  }

  const toolExecution = asLooseRecord(record.toolExecution);
  if (toolExecution) {
    const nestedValue = extractExecutionValue(toolExecution);
    if (nestedValue !== undefined) {
      return nestedValue;
    }
  }

  return payload;
}
