/** Explicit units only. No ambiguous numeric strings or unbounded sessions. */
export function parseTokenLifetime(value: string): number | null {
  const match = /^([1-9]\d*)(s|m|h|d)$/.exec(value);
  if (!match) return null;
  const units: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  const seconds = Number(match[1]) * (units[match[2] ?? ''] ?? 0);
  return Number.isSafeInteger(seconds) && seconds >= 60 && seconds <= 604800 ? seconds : null;
}
