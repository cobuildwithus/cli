export function requireParticipantString(
  value: string | undefined,
  usage: string,
  label: string
): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`${usage}\n${label} is required.`);
  }
  return value.trim();
}

export function requireParticipantBigintLike(
  value: string | number | bigint | undefined,
  usage: string,
  label: string
): string | number | bigint {
  if (value === undefined) {
    throw new Error(`${usage}\n${label} is required.`);
  }
  if (typeof value === "string") {
    if (value.trim().length === 0) {
      throw new Error(`${usage}\n${label} is required.`);
    }
    return value.trim();
  }
  return value;
}
