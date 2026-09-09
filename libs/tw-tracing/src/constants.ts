/**
 * The wire contract for distributed tracing across the workspace.
 *
 * Every value here is exported rather than written as a literal at each call site. That is a
 * deliberate choice: a header name repeated as a raw string in a dozen repositories drifts —
 * a casing variant, a typo, a service that forwards `x-traceid` — and each drift silently
 * breaks correlation for exactly one hop, which is the hardest kind of gap to notice.
 */

/**
 * The HTTP header carrying the trace id. Lowercase, because Node normalises inbound header names
 * to lowercase and `req.headers` lookups are case-sensitive.
 *
 * On the wire HTTP header names are case-insensitive, so a caller sending `X-Trace-Id` is still
 * understood — see {@link getTraceId}, which searches case-insensitively.
 */
export const TRACE_ID_HEADER = 'x-trace-id';

/**
 * The field name the trace id takes inside a JSON log line. Kept distinct from the header constant
 * on purpose: the header is a network contract, the field is a log-schema contract, and they are
 * consumed by different systems (services vs. LogQL queries and dashboards).
 */
export const TRACE_ID_FIELD = 'traceId';

/**
 * Separator used when a trace id is extended for work that fans out from one parent — a page of a
 * sync run, a chunk of a parallel batch, a message handed to a broker.
 *
 * @see deriveTraceId
 */
export const TRACE_ID_SEGMENT_SEPARATOR = '-';

/**
 * Longest trace id accepted off an inbound request. Longer ids are truncated to this length.
 *
 * Not a format check — the format is deliberately open, because ids built by `deriveTraceId` are
 * legitimate and unpredictable. This caps one thing only: an id we did not mint is copied onto
 * every log line of every service in the chain, so its length is multiplied by the whole request
 * fan-out. A caller sending a few kilobytes of header would have every hop write a few kilobytes
 * per line.
 *
 * 128 is far above anything real. A ULID is 26 characters, and a derived id — `<ulid>-page-3-chunk-2`
 * — is well under 50, so this never fires on traffic we generate ourselves.
 */
export const MAX_TRACE_ID_LENGTH = 128;
