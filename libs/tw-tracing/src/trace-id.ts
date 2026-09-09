import { ulid } from 'ulidx';
import { MAX_TRACE_ID_LENGTH, TRACE_ID_HEADER, TRACE_ID_SEGMENT_SEPARATOR } from './constants';

/** The minimal shape this package needs from an inbound request. Framework-agnostic on purpose. */
export interface RequestLike {
  headers?: Record<string, unknown>;
}

/**
 * Mints a new trace id.
 *
 * A ULID is used because it is lexicographically sortable by creation time, URL-safe, and
 * recognisable in free text — which matters when the id arrives pasted into a bug report rather
 * than typed into a search box.
 *
 * @returns A 26-character Crockford base32 ULID, e.g. `01M0J6EYRY4TFEPR9PHJZ1QHPF`.
 */
export function newTraceId(): string {
  return ulid();
}

/**
 * Builds a child trace id from a parent, for work that has no inbound request of its own.
 *
 * The result stays greppable as one family: a Loki filter on the parent id returns the parent and
 * every derived leg, because `|=` is a substring match. That is the whole reason the suffix is
 * appended rather than the id being replaced.
 *
 * @param parent - The id to extend. Any string; it does not have to be a ULID.
 * @param segments - Segments to append, e.g. a page number, a chunk index, a leg name.
 * @returns The extended id, e.g. `01M0J6EYRY4TFEPR9PHJZ1QHPF-page-3`.
 * @example
 * // A paginated sync run: one id per page, all provably part of one session.
 * const traceId = deriveTraceId(sessionId, 'page', String(page));
 */
export function deriveTraceId(parent: string, ...segments: (string | number)[]): string {
  return [parent, ...segments].join(TRACE_ID_SEGMENT_SEPARATOR);
}

/**
 * Reads the trace id off an inbound request, case-insensitively.
 *
 * The fast path — an exact lowercase hit — covers everything Node's HTTP server produces. The slow
 * path exists for requests assembled by hand in tests and for non-Node runtimes that preserve the
 * sender's casing.
 *
 * @param req - Anything with a `headers` object.
 * @returns The trace id, or `undefined` when the request carries none.
 */
export function getTraceId(req?: RequestLike): string | undefined {
  const headers = req?.headers;
  if (!headers) return undefined;

  const direct = headers[TRACE_ID_HEADER];
  if (typeof direct === 'string' && direct !== '') return direct;

  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() !== TRACE_ID_HEADER) continue;
    const value = headers[key];
    if (typeof value === 'string' && value !== '') return value;
    if (Array.isArray(value) && typeof value[0] === 'string' && value[0] !== '') return value[0];
  }

  return undefined;
}

/**
 * Ensures the request carries a trace id, minting one only when it does not.
 *
 * **This mutates `req.headers` in place**, and that mutation is the entire mechanism the rest of the
 * system relies on: every request-scoped provider downstream reads the same headers object, so
 * seeding it once here is what makes the id available everywhere without being passed as an
 * argument. Returning the id as well is a convenience, not the point.
 *
 * Inheriting an existing id rather than overwriting it is what makes the trace *distributed* — the
 * first service to see a request creates the id, every service after it adopts one.
 *
 * An inherited id is **truncated to {@link MAX_TRACE_ID_LENGTH}**, and that is the only thing done
 * to it. The value arrives from outside — for an edge service, straight from a browser — and it is
 * then copied onto every log line of every service in the chain, so its length is multiplied by the
 * whole request fan-out. Truncation is deliberately all there is: the format stays open because
 * `deriveTraceId` produces legitimate ids nobody can predict, and header values cannot carry
 * control characters in the first place — Node's HTTP parser rejects those before this is reached.
 *
 * Truncation is idempotent and the cap is the same everywhere, so a long id is shortened once at
 * the first hop and every service after it inherits the identical value. A cap that varied between
 * services would split one trace into two.
 *
 * @param req - The inbound request. Its `headers` object is created if missing.
 * @param maxLength - Override the cap. Defaults to {@link MAX_TRACE_ID_LENGTH}.
 * @returns The trace id now on the request — inherited if one was present, freshly minted otherwise.
 */
export function ensureTraceId(req: RequestLike, maxLength: number = MAX_TRACE_ID_LENGTH): string {
  const existing = getTraceId(req);
  // The common path by far: an id we or another of our services minted. Nothing to do.
  if (existing !== undefined && existing.length <= maxLength) return existing;

  const traceId = existing === undefined ? newTraceId() : existing.slice(0, maxLength);
  if (!req.headers) req.headers = {};

  // Remove every casing variant before writing, so nothing downstream can read back the original
  // over-length value from an `X-Trace-Id` the sender used instead.
  for (const key of Object.keys(req.headers)) {
    if (key.toLowerCase() === TRACE_ID_HEADER) delete req.headers[key];
  }

  req.headers[TRACE_ID_HEADER] = traceId;
  return traceId;
}
