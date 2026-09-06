/**
 * Loki log lines → typed trace events.
 *
 * Three shapes are tolerated, in this order:
 *
 *   1. A `@tw/logger` envelope whose `message` is itself a request-log JSON document. These carry
 *      `direction`, and they are the only lines that produce spans and edges.
 *   2. A `@tw/logger` envelope with an ordinary message — an application log line. These become
 *      `event` records: no edge, but they are usually where the actual cause is written.
 *   3. Anything else, kept verbatim as `raw` and attributed from its Loki stream labels.
 *
 * The third case matters more than it looks. A service that logs in an unfamiliar format — another
 * team's, a sidecar's, one that has not adopted the logger yet — must still show up as a
 * participant. Dropping it silently is how a trace grows a hole that reads as "this service was
 * never called".
 */

/** Reads the container/service label off a Loki stream. */
function serviceFromLabels(labels = {}) {
  return labels.container ?? labels.app ?? labels.pod ?? labels.job ?? undefined;
}

/**
 * Splits a `User-Agent` into the originating caller.
 *
 * Intermediaries append rather than replace, so `"products-service, Some-Proxy/1.4"` names
 * products-service as the originator. Browsers also contain commas inside their UA string, which is
 * why anything that still looks like a browser UA is collapsed to `browser` rather than truncated
 * into nonsense.
 */
export function normalizeCaller(userAgent) {
  if (!userAgent) return undefined;

  const first = String(userAgent).split(',')[0].trim();
  if (/^Mozilla\//i.test(first) || /\b(Chrome|Safari|Firefox|Edg)\//i.test(userAgent)) return 'browser';
  return first || undefined;
}

/**
 * Parses one Loki entry.
 *
 * @param {string} line - The raw log line.
 * @param {object} labels - Loki stream labels for the line.
 * @param {string} timestamp - ISO timestamp from Loki.
 * @returns {object} A typed event. Never null — an unparseable line becomes `kind: 'raw'`.
 */
export function parseLine(line, labels = {}, timestamp) {
  const labelService = serviceFromLabels(labels);

  let envelope;
  try {
    envelope = JSON.parse(line);
  } catch {
    return { kind: 'raw', timestamp, service: labelService, line };
  }

  if (!envelope || typeof envelope !== 'object' || !envelope.serviceName) {
    return { kind: 'raw', timestamp, service: labelService, line };
  }

  const base = {
    timestamp: envelope.timestamp ?? timestamp,
    // The body wins over the label: `serviceName` is what the service calls itself, and it is the
    // name that has to match the `caller` other services report.
    service: envelope.serviceName ?? labelService,
    podId: envelope.podId,
    level: envelope.level,
    context: envelope.context,
    traceId: envelope.traceId,
  };

  let payload;
  try {
    payload = JSON.parse(envelope.message);
  } catch {
    payload = null;
  }

  if (payload && typeof payload === 'object' && (payload.direction === 'incoming' || payload.direction === 'outgoing')) {
    return {
      ...base,
      kind: 'request',
      direction: payload.direction,
      method: payload.method,
      path: payload.path ?? stripQuery(payload.url),
      statusCode: payload.statusCode,
      duration: payload.duration,
      caller: normalizeCaller(payload.caller),
    };
  }

  return { ...base, kind: 'event', message: envelope.message, trace: envelope.trace };
}

function stripQuery(url) {
  if (!url) return undefined;
  return String(url).split('?')[0];
}

/**
 * Parses a Loki `query_range` response into a timestamp-ordered event list.
 *
 * Loki returns newest-first within each stream and does not order across streams at all, so sorting
 * here is not cosmetic — every downstream step assumes chronological order.
 */
export function parseLokiResponse(apiResponse) {
  const streams = apiResponse?.data?.result ?? [];
  const events = [];

  for (const stream of streams) {
    for (const [tsNano, line] of stream.values ?? []) {
      const timestamp = new Date(Math.floor(Number(tsNano) / 1e6)).toISOString();
      events.push(parseLine(line, stream.stream ?? {}, timestamp));
    }
  }

  events.sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));
  return events;
}
