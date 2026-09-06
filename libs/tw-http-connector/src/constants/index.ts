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
