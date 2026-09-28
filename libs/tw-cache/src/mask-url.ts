/**
 * Hides the password of a cache URL before it reaches a log line.
 *
 * The URL carries an ACL password in every environment that uses them, and the boot line that
 * names where the cache is connecting is exactly the line people read when debugging — so it has
 * to name the server without naming the credential.
 */
export function maskUrl(url: string): string {
  return url.replace(/^(rediss?:\/\/[^:@\s]+):[^@\s]+@/, '$1:***@');
}