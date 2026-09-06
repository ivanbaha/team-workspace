/**
 * Renders an unknown thrown value as a log-safe string.
 *
 * `JSON.stringify(error)` on an `Error` yields `{}` — the message and stack are non-enumerable —
 * which is how "the call failed" ends up in the logs with no indication of why.
 */
export function errorToString(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as Error & { cause?: unknown }).cause;
    return cause ? `${error.name}: ${error.message} (cause: ${errorToString(cause)})` : `${error.name}: ${error.message}`;
  }
  if (typeof error === 'string') return error;

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
