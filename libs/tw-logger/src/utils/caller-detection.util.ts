/**
 * Stack frames that are never the answer: the logger's own plumbing, Node internals, and the
 * transpiler helpers that sit between an `await` and the code that wrote it.
 */
const SKIP_PATTERNS = [
  /logger\.service/,
  /request-scoped-logger/,
  /LoggerService/,
  /RequestScopedLoggerService/,
  /node_modules/,
  /node:internal/,
  /at processTicksAndRejections/,
  /at Object\.next/,
  /at step \(/,
  /at __awaiter/,
];

/** Matches `at ClassName.methodName (file:line:col)`, with or without `async`. */
const CONTEXT_REGEX = /at\s+(?:async\s+)?(?:exports\.)?([^\s(]+)\s+\(/;

/**
 * Derives a `context` value from the call stack when the caller did not supply one.
 *
 * A best-effort convenience, not a contract: it costs one thrown-and-caught `Error` per log line
 * that omits a context, and minified or heavily transpiled builds can defeat it. Pass an explicit
 * context on any line you expect to search for.
 *
 * @returns `ClassName.methodName`, or `'unknown'`.
 */
export function detectCaller(): string {
  const stack = new Error().stack;
  if (!stack) return 'unknown';

  for (const line of stack.split('\n').slice(1)) {
    if (SKIP_PATTERNS.some((pattern) => pattern.test(line))) continue;

    const match = CONTEXT_REGEX.exec(line);
    const context = match?.[1];
    if (!context) continue;
    if (context === 'Object.<anonymous>' || context === 'Module._compile') continue;

    return context;
  }

  return 'unknown';
}
