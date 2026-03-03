const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.toLowerCase());
}

function parseAbsoluteUrl(value: string, label: string): URL {
  try {
    return new URL(value);
  } catch {
    throw new Error(`${label} is invalid. Use an absolute https URL.`);
  }
}

export function parseAndValidateApiBaseUrl(baseUrl: string, label: string = "API base URL"): URL {
  const parsed = parseAbsoluteUrl(baseUrl, label);
  if (parsed.username || parsed.password) {
    throw new Error(`${label} must not include username or password.`);
  }

  if (parsed.protocol === "https:") {
    return parsed;
  }

  if (parsed.protocol === "http:" && isLoopbackHost(parsed.hostname)) {
    return parsed;
  }

  throw new Error(
    `${label} must use https (http is allowed only for localhost, 127.0.0.1, or [::1]).`
  );
}

export function normalizeApiUrlInput(
  rawValue: string,
  label: "Interface URL" | "Chat API URL"
): string {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    throw new Error(`${label} cannot be empty.`);
  }

  let candidate = trimmed;
  if (!/^https?:\/\//i.test(candidate)) {
    let host = "";
    try {
      host = new URL(`http://${candidate}`).hostname;
    } catch {
      host = "";
    }
    const prefix = isLoopbackHost(host) ? "http://" : "https://";
    candidate = `${prefix}${candidate}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(
      `${label} is invalid. Use a full URL like https://co.build or http://localhost:3000.`
    );
  }

  if (parsed.username || parsed.password) {
    throw new Error(`${label} must not include username or password.`);
  }
  if (parsed.protocol === "http:" && !isLoopbackHost(parsed.hostname)) {
    throw new Error(
      `${label} must use https (http is allowed only for localhost, 127.0.0.1, or [::1]).`
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${label} must use http or https.`);
  }

  if (parsed.pathname === "/" && !parsed.search && !parsed.hash) {
    return parsed.origin;
  }

  return parsed.toString();
}
