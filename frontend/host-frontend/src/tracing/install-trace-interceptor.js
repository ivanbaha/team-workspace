/**
 * The first hop of every distributed trace.
 *
 * Wraps `window.fetch` so each call to our own APIs carries a freshly minted trace id in
 * `x-trace-id`. Every service downstream inherits that id rather than minting its own, so the whole
 * request chain lands in the logs under one value — and the id a user pastes into a bug report is
 * the same one the backend logged.
 *
 * **Install this once, in the host, before mounting any remote.** Module Federation remotes share
 * one `window`, so a remote that installs its own stacks a second patch on the host's: three
 * wrappers deep, with a load-order dependency nobody wants to debug. Remotes just call `fetch`.
 *
 * See docs/architecture/distributed-tracing.md — "The entry point — the browser".
 */

const TRACE_ID_HEADER = 'x-trace-id';

/** Matches MAX_TRACE_ID_LENGTH in @tw/tracing. One cap everywhere, or a long id splits a trace. */
const MAX_TRACE_ID_LENGTH = 128;

const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Mints a ULID: 48-bit timestamp then 80 bits of randomness, Crockford base32.
 *
 * Hand-rolled rather than pulled from `ulidx` because the frontends carry no dependencies, and a
 * trace id only has to be unique and recognisable — it is never parsed back.
 *
 * @returns {string} A 26-character ULID, lexicographically sortable by creation time.
 */
function ulid() {
  let timestamp = Date.now();
  let out = '';

  for (let i = 9; i >= 0; i--) {
    out = ULID_ALPHABET[timestamp % 32] + out;
    timestamp = Math.floor(timestamp / 32);
  }

  const random = new Uint8Array(16);
  crypto.getRandomValues(random);
  for (let i = 0; i < 16; i++) out += ULID_ALPHABET[random[i] % 32];

  return out.slice(0, 26);
}

/**
 * Patches `window.fetch` to attach a trace id to calls aimed at our own APIs.
 *
 * @param {string[]} apiOrigins - Origins that get the header. Everything else — CDNs, analytics,
 *   third-party widgets — is left alone: a trace id is internal correlation data and there is no
 *   reason to hand it to someone else's server.
 * @returns {() => void} Removes the patch. Only useful in tests.
 */
export function installTraceInterceptor(apiOrigins) {
  const original = window.fetch;

  window.fetch = async (input, init) => {
    const request = new Request(input, init);

    let origin;
    try {
      origin = new URL(request.url).origin;
    } catch {
      return original(request);
    }
    if (!apiOrigins.includes(origin)) return original(request);

    // Inherit, never overwrite — the same rule the services follow. A caller that set the header
    // meant it: a retry of a failed call is the same user action and belongs under the same id.
    const inherited = request.headers.get(TRACE_ID_HEADER);
    const traceId = inherited ? inherited.slice(0, MAX_TRACE_ID_LENGTH) : ulid();
    request.headers.set(TRACE_ID_HEADER, traceId);

    // `user-agent` is browser-controlled: a page may ask, and the browser ignores it. So the
    // frontend can only ever hold up the id half of the contract, and every call from the page is
    // attributed to the single node `browser`.
    const response = await original(request);

    // Surfacing the id on failure is the point of the whole exercise: it is what a user can paste
    // into a bug report, and what turns "the page broke" into one LogQL query. Reading it back off
    // the response needs `Access-Control-Expose-Headers: x-trace-id` when the API is cross-origin.
    if (!response.ok) {
      console.error(`${request.method} ${request.url} failed under trace ${traceId}`);
    }

    return response;
  };

  return () => {
    window.fetch = original;
  };
}
