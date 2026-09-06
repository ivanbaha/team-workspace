/**
 * Partially masks a secret so a log line stays correlatable without the value being replayable.
 *
 * Keeping the first and last characters is the point: two masked tokens can still be compared to
 * each other, which is how you tell "the same expired token on every retry" from "a new token each
 * time". A blanket `***` throws that away.
 */
export function maskString(str?: string): string | undefined {
  if (!str) return undefined;

  const len = str.length;
  if (len < 3) return str[0] + '*';
  if (len < 5) return `${str.substring(0, 1)}**${str.substring(len - 1)}`;
  return `${str.substring(0, 2)}**...**${str.substring(len - 2)}`;
}
