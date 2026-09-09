/**
 * DI token for the process-wide connector.
 *
 * The request-scoped wrapper depends on this token rather than on the class, so the module can bind
 * it with `useExisting` — one connector holding the retry policy and the logger, and one small
 * inheriting wrapper per request.
 */
export const BASE_HTTP_CONNECTOR = 'BASE_HTTP_CONNECTOR';

/** DI token for the logger the connector writes its verbose request/response records through. */
export const HC_LOGGER = 'HC_LOGGER';

/** Headers forwarded from the inbound request when the caller does not override the list. */
export const DEFAULT_FORWARD_HEADERS: string[] = ['accept-language'];

/**
 * The header carrying this service's identity. Lowercase for the same reason as
 * `TRACE_ID_HEADER`: comparisons are case-sensitive even though the wire is not.
 *
 * It is the second half of the tracing contract and the half that is easy to forget.
 * `x-trace-id` groups a trace's log lines; `user-agent` is what the receiving service records as
 * `caller`, and `caller` is the only edge information a trace has — there are no parent span ids.
 * Without it you get a bag of correlated lines and no call graph.
 */
export const USER_AGENT_HEADER = 'user-agent';

/**
 * The casing the connector puts on the wire. Node lowercases inbound header names anyway, so this
 * is cosmetic — but `User-Agent` is what a person reading a request dump expects to see.
 */
export const USER_AGENT_HEADER_WIRE_CASE = 'User-Agent';

/**
 * Headers that may never be added to `forwardHeaders`.
 *
 * Both already have a dedicated, unconditional path through the connector. Forwarding them as well
 * would put the inbound value in the same header the connector writes its own into — for
 * `user-agent`, the browser's UA competing with the service identity, which orphans every edge the
 * service contributes. Making the misconfiguration impossible is cheaper than making it detectable:
 * the symptom is a trace that still looks complete.
 */
export const NON_FORWARDABLE_HEADERS: readonly string[] = [USER_AGENT_HEADER, 'x-trace-id'];
