import { writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { mkdirSync } from 'fs';
import { GrafanaAPI } from './api.js';
import {
  DEFAULT_LIMIT,
  DEFAULT_LOOKBACK_MS,
  ENVIRONMENT_TIERS,
  MAX_LOOKBACK_MS,
  assembleTrace,
  buildTraceQuery,
  extractTraceId,
  renderReport,
  summarize,
} from './trace/index.js';

const toNanoSeconds = (date) => String(date.getTime()) + '000000';

/**
 * Orders configured environments into search tiers.
 *
 * Anything not named in `ENVIRONMENT_TIERS` is appended last rather than dropped — an environment
 * the tool has never heard of is still somewhere a trace might live.
 */
function orderEnvironments(configured) {
  const remaining = new Set(configured);
  const ordered = [];

  for (const tier of ENVIRONMENT_TIERS) {
    for (const name of tier) {
      if (remaining.delete(name)) ordered.push(name);
    }
  }
  return [...ordered, ...remaining];
}

/**
 * Traces one id across every configured Grafana environment.
 *
 * Injected with `GrafanaTools` rather than reading credentials itself, so the connector and the MCP
 * tool share one implementation and one credential source.
 */
export class TraceTool {
  constructor(grafanaTools) {
    this.grafana = grafanaTools;
  }

  createResponse(success, data = null, message = '') {
    return { success, data, message };
  }

  /**
   * @param {object} args
   * @param {string} args.trace_id - The id, or any text containing one.
   * @param {string} [args.environment] - Search only this environment. Much faster.
   * @param {string} [args.start] - ISO start of the search window.
   * @param {string} [args.end] - ISO end of the search window.
   * @param {number} [args.lookback_hours] - Window size when `start` is absent.
   * @param {string} [args.output_file] - Write the full Markdown report here.
   * @param {number} [args.limit] - Max log lines fetched.
   */
  async trace(args = {}) {
    const resolved = extractTraceId(args.trace_id);
    if (!resolved) {
      return this.createResponse(
        false,
        null,
        'No trace id found in the input. Pass the id itself, or a log line / URL containing it.',
      );
    }

    if (Object.keys(this.grafana.datasources).length === 0) {
      await this.grafana.getAvailable();
    }

    const configured = Object.keys(this.grafana.envConfig ?? {});
    if (configured.length === 0) {
      return this.createResponse(false, null, 'No Grafana environments are configured. Set GRAFANA_ENVS in .env.');
    }

    if (args.environment && !configured.includes(args.environment)) {
      return this.createResponse(
        false,
        null,
        `Environment "${args.environment}" is not configured. Configured: ${configured.join(', ')}.`,
      );
    }

    const { start, end } = this.resolveWindow(args);
    const environments = args.environment ? [args.environment] : orderEnvironments(configured);
    const probes = [];

    for (const environment of environments) {
      const probe = await this.searchEnvironment(environment, resolved, start, end, args.limit ?? DEFAULT_LIMIT);
      probes.push({ environment, status: probe.status, ...(probe.error ? { error: probe.error } : {}) });

      if (probe.status !== 'found') continue;

      const trace = assembleTrace(resolved, environment, probe.response);
      const summary = summarize(trace);
      const written = args.output_file ? this.writeReport(trace, args.output_file) : null;

      return this.createResponse(
        true,
        written ? { ...summary, reportFile: written } : summary,
        this.describe(trace, probe.truncated),
      );
    }

    // "Not found" is deliberately NOT an error: the agent has to be able to reason about it, and to
    // tell "proven absent" apart from "we could not look".
    const inconclusive = probes.filter((probe) => probe.status !== 'empty');
    return this.createResponse(
      true,
      { found: false, traceId: resolved, searched: environments, probes },
      `Trace ${resolved} not found in: ${environments.join(', ')}.` +
        (inconclusive.length > 0
          ? ` ${inconclusive.length} environment(s) were unreachable or errored — this is NOT proof of absence.`
          : '') +
        ` Searched ${start.toISOString()} → ${end.toISOString()}; widen it with lookback_hours if the request is older.`,
    );
  }

  /*************************************************************************
   *                           PRIVATE                                     *
   ************************************************************************/

  resolveWindow({ start, end, lookback_hours: lookbackHours }) {
    const endDate = end ? new Date(end) : new Date();
    if (start) return { start: new Date(start), end: endDate };

    const requested = lookbackHours ? lookbackHours * 60 * 60 * 1000 : DEFAULT_LOOKBACK_MS;
    // Loki answers a wider range with an opaque HTTP 400, so the cap is applied here where it can
    // be explained rather than surfacing as a failed query.
    const span = Math.min(requested, MAX_LOOKBACK_MS);
    return { start: new Date(endDate.getTime() - span), end: endDate };
  }

  async searchEnvironment(environment, traceId, start, end, limit) {
    const datasource = this.grafana.datasources[environment];
    if (!datasource) return { status: 'unreachable', error: 'no Loki datasource (environment may be down)' };

    const { url, pat } = this.grafana.envConfig[environment];
    const api = new GrafanaAPI(url, pat);
    const query = buildTraceQuery(traceId, this.grafana.namespaceRegexFor?.(environment));

    try {
      const response = await api.queryLoki(
        datasource.uid,
        query,
        toNanoSeconds(start),
        toNanoSeconds(end),
        limit,
        'forward',
      );
      const lines = (response?.data?.result ?? []).reduce((total, stream) => total + (stream.values?.length ?? 0), 0);
      if (lines === 0) return { status: 'empty' };
      return { status: 'found', response, truncated: lines >= limit };
    } catch (error) {
      return { status: 'unreachable', error: error.message };
    }
  }

  writeReport(trace, outputFile) {
    const path = resolve(outputFile);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, renderReport(trace), 'utf8');
    return path;
  }

  describe(trace, truncated) {
    const parts = [
      `${trace.spans.length} span(s) across ${trace.coverage.traced.length} service(s) in ${trace.environment}`,
    ];
    if (trace.wallTimeMs !== undefined) parts.push(`${trace.wallTimeMs}ms wall time`);
    if (trace.coverage.gaps.length > 0) parts.push(`${trace.coverage.gaps.length} coverage gap(s)`);
    if (trace.problems.length > 0) parts.push(`${trace.problems.length} error/warning(s)`);
    if (truncated) parts.push('LINE LIMIT REACHED — the trace may be incomplete');
    return parts.join('; ') + '.';
  }
}
