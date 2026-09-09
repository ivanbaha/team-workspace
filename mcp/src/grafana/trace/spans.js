/**
 * Assembles request events into spans and caller → callee edges.
 *
 * A flat trace id carries no span identity, so pairing a `request.in` with its `response.out` is done per
 * `(service, method, path)` in timestamp order. That is exact for sequential calls and a
 * best-effort guess when one caller hits the same endpoint concurrently.
 *
 * Consumers must read `paired: false` and `ambiguous: true` as **"do not trust the elapsed time"**,
 * never as "the call did not happen". The alternative — silently dropping what cannot be paired
 * cleanly — hides exactly the concurrent, retried, fan-out traffic that is hardest to debug.
 */

/** Services that hand work off asynchronously; their subtree is excluded from wall time. */
const ASYNC_BROKERS = new Set([]);

/**
 * Callers whose reported name differs from the name they log under.
 *
 * Every entry here is a service whose outbound `User-Agent` disagrees with its `DEPLOYMENT_NAME`.
 * The map keeps its edges from orphaning, but it is a workaround, not a fix — a chain that only
 * resolves because of an entry here is a chain that would break for anyone without this tool.
 */
const CALLER_ALIASES = new Map([]);

const resolveAlias = (name) => (name && CALLER_ALIASES.get(name)) || name;

const spanKey = (event) => `${event.service}|${event.method}|${event.path}`;

/**
 * Pairs `request.in` and `response.out` records into spans. Legacy `incoming`/`outgoing` lines
 * arrive here already normalised by `parse.js`, so only the canonical pair is handled below.
 *
 * @param {object[]} events - Parsed events, in timestamp order.
 * @returns {object[]} Spans, ordered by start time.
 */
export function buildSpans(events) {
  const pending = new Map();
  const spans = [];

  for (const event of events) {
    if (event.kind !== 'request') continue;
    const key = spanKey(event);

    if (event.direction === 'request.in') {
      const span = {
        service: event.service,
        podId: event.podId,
        method: event.method,
        path: event.path,
        caller: resolveAlias(event.caller),
        start: event.timestamp,
        end: undefined,
        statusCode: undefined,
        duration: undefined,
        paired: false,
        ambiguous: false,
      };
      const queue = pending.get(key) ?? [];
      // More than one open request on the same endpoint means the pairing below is a guess.
      if (queue.length > 0) span.ambiguous = true;
      queue.push(span);
      pending.set(key, queue);
      spans.push(span);
      continue;
    }

    const queue = pending.get(key);
    const span = queue?.shift();
    if (!span) {
      // A response.out with no request.in: the window clipped the start, or logging was enabled
      // mid-request. Keep it as a span of its own rather than discarding the status code.
      spans.push({
        service: event.service,
        podId: event.podId,
        method: event.method,
        path: event.path,
        caller: undefined,
        start: event.timestamp,
        end: event.timestamp,
        statusCode: event.statusCode,
        duration: event.duration,
        paired: false,
        orphanedResponse: true,
        ambiguous: false,
      });
      continue;
    }

    span.end = event.timestamp;
    span.statusCode = event.statusCode;
    span.duration = event.duration;
    span.paired = true;
    if (queue.length > 0) span.ambiguous = true;
  }

  // Anything still open never produced a response: a crash, a timeout, a request still in flight.
  // Flagged rather than dropped — an unterminated span is often the answer.
  for (const queue of pending.values()) {
    for (const span of queue) span.unterminated = true;
  }

  return spans.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
}

/**
 * Collapses spans into caller → callee edges.
 *
 * The only edge information that exists is the `caller` each callee reported, taken from the
 * forwarded `User-Agent`. There are no parent span ids, so repeated identical calls are grouped and
 * counted rather than individually linked.
 */
export function buildEdges(spans) {
  const edges = new Map();

  for (const span of spans) {
    if (!span.caller) continue;
    const key = `${span.caller}|${span.service}|${span.method}|${span.path}`;
    const edge = edges.get(key) ?? {
      from: span.caller,
      to: span.service,
      method: span.method,
      path: span.path,
      calls: [],
    };
    edge.calls.push({
      start: span.start,
      statusCode: span.statusCode,
      duration: span.duration,
      ambiguous: span.ambiguous || undefined,
      unterminated: span.unterminated || undefined,
    });
    edges.set(key, edge);
  }

  return [...edges.values()].sort((a, b) => (a.calls[0].start < b.calls[0].start ? -1 : 1));
}

/**
 * Nests spans into a call tree.
 *
 * A span's parent is the *nearest preceding* span belonging to its reported caller. "Nearest" rather
 * than "first" because pod clocks are not synchronised: a callee's log can predate its caller's by a
 * few milliseconds, and a strict start-time comparison would promote a nested call to a root.
 */
export function buildCallTree(spans) {
  const nodes = spans.map((span) => ({ ...span, children: [] }));
  const roots = [];

  for (const node of nodes) {
    const candidates = nodes.filter((candidate) => candidate !== node && candidate.service === node.caller);

    if (candidates.length === 0) {
      roots.push(node);
      continue;
    }

    let best = candidates[0];
    let bestDistance = Infinity;
    for (const candidate of candidates) {
      const distance = Math.abs(Date.parse(node.start) - Date.parse(candidate.start));
      if (distance < bestDistance) {
        bestDistance = distance;
        best = candidate;
      }
    }
    best.children.push(node);
  }

  return roots;
}

/**
 * Splits the participants into what was traced and what was not.
 *
 * `gaps` is the important half. A service that appears only as somebody's `caller`, and never
 * logged a request of its own, took part in the request but is invisible — usually because it has
 * not adopted `@tw/logger`, is below `info` level, or is not ours. **A gap never means the service
 * was skipped.**
 */
export function analyzeCoverage(spans, events) {
  const traced = new Set();
  for (const span of spans) traced.add(span.service);
  for (const event of events) {
    if (event.kind !== 'request' && event.service) traced.add(event.service);
  }

  const callers = new Set();
  for (const span of spans) if (span.caller) callers.add(span.caller);

  const gaps = [...callers].filter((caller) => !traced.has(caller) && caller !== 'browser');
  const externalCallers = [...callers].filter((caller) => caller === 'browser' || /\//.test(caller));

  return {
    traced: [...traced].sort(),
    gaps: gaps.filter((caller) => !externalCallers.includes(caller)).sort(),
    externalCallers: externalCallers.sort(),
  };
}

/**
 * Wall time of the whole trace, excluding anything below an async broker.
 *
 * Work handed to a broker happens after the caller already responded, so counting it would report
 * webhook-delivery latency as user-facing latency.
 */
export function wallTime(spans) {
  const relevant = spans.filter((span) => !ASYNC_BROKERS.has(span.caller));
  if (relevant.length === 0) return undefined;

  const starts = relevant.map((span) => Date.parse(span.start));
  const ends = relevant.map((span) => Date.parse(span.end ?? span.start));
  return Math.max(...ends) - Math.min(...starts);
}

/** Errors and warnings logged under the trace — usually where the actual cause is written. */
export function collectProblems(events, spans) {
  const problems = [];

  for (const event of events) {
    if (event.kind === 'event' && (event.level === 'error' || event.level === 'warn')) {
      problems.push({
        level: event.level,
        service: event.service,
        context: event.context,
        message: event.message,
        timestamp: event.timestamp,
      });
    }
  }

  for (const span of spans) {
    if (span.statusCode && span.statusCode >= 400) {
      problems.push({
        level: span.statusCode >= 500 ? 'error' : 'warn',
        service: span.service,
        context: `${span.method} ${span.path}`,
        message: `responded ${span.statusCode}`,
        timestamp: span.end ?? span.start,
      });
    }
    if (span.unterminated) {
      problems.push({
        level: 'error',
        service: span.service,
        context: `${span.method} ${span.path}`,
        message: 'request never produced a response (crash, timeout, or still in flight)',
        timestamp: span.start,
      });
    }
  }

  return problems.sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1));
}

/** Edges called more than once — duplicated work or cache misses. Reported, never resolved. */
export function repeatedEdges(edges) {
  return edges
    .filter((edge) => edge.calls.length > 1)
    .map((edge) => ({ from: edge.from, to: edge.to, call: `${edge.method} ${edge.path}`, count: edge.calls.length }));
}
