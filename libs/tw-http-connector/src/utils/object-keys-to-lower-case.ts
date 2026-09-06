/**
 * Lowercases every key of a header record.
 *
 * Header names are case-insensitive on the wire but case-sensitive as object keys, so
 * `{ 'X-Trace-Id': a }` and `{ 'x-trace-id': b }` merge into two headers rather than one. Everything
 * is normalised on the way in so that later overrides actually override.
 */
export function objectKeysToLowerCase(source?: Record<string, string>): Record<string, string> {
  if (!source) return {};

  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) out[key.toLowerCase()] = value;
  return out;
}
