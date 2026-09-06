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
