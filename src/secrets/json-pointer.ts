function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodePointerSegment(value: string): string {
  return value.replaceAll("~1", "/").replaceAll("~0", "~");
}

function parsePointer(pointer: string): string[] {
  if (!pointer.startsWith("/")) {
    throw new Error(`Invalid JSON pointer: ${pointer}`);
  }
  if (pointer === "/") {
    return [""];
  }
  return pointer
    .slice(1)
    .split("/")
    .map((segment) => decodePointerSegment(segment));
}

export function readJsonPointer(payload: unknown, pointer: string): unknown {
  const segments = parsePointer(pointer);
  let current: unknown = payload;

  for (const segment of segments) {
    if (!isRecord(current) || !(segment in current)) {
      throw new Error(`Missing JSON pointer path: ${pointer}`);
    }
    current = current[segment];
  }

  return current;
}

export function writeJsonPointer(
  payload: Record<string, unknown>,
  pointer: string,
  value: unknown
): Record<string, unknown> {
  const segments = parsePointer(pointer);
  let current: Record<string, unknown> = payload;

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const isLeaf = index === segments.length - 1;

    if (isLeaf) {
      current[segment] = value;
      return payload;
    }

    const existing = current[segment];
    if (isRecord(existing)) {
      current = existing;
      continue;
    }

    const next: Record<string, unknown> = {};
    current[segment] = next;
    current = next;
  }

  return payload;
}

export function deleteJsonPointer(payload: Record<string, unknown>, pointer: string): boolean {
  const segments = parsePointer(pointer);
  let current: Record<string, unknown> = payload;

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const isLeaf = index === segments.length - 1;
    if (isLeaf) {
      if (!(segment in current)) {
        return false;
      }
      delete current[segment];
      return true;
    }

    const existing = current[segment];
    if (!isRecord(existing)) {
      return false;
    }
    current = existing;
  }

  return false;
}
