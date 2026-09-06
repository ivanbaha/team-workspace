export const grafanaToolSchemas = [
  {
    name: 'grafana_get_available',
    description:
      'Validates connectivity to all configured Grafana environments and returns availability status of each.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'grafana_search_logs',
    description:
      'Search logs in a Grafana/Loki environment. ' +
      'Can fetch logs for a specific service, search by string within a service, or search globally across namespaces. ' +
      'Requires grafana_get_available to have been called first. ' +
      'Returns only log lines, all metadata is omitted.',
    inputSchema: {
      type: 'object',
      properties: {
        environment: {
          type: 'string',
          description: 'Grafana environment to query (e.g. "test", "uat", "prod-india")',
        },
        service: {
          type: 'string',
          description: 'Container/service name to filter logs by (e.g. "tw-companies-sync-service")',
        },
        search: {
          type: 'string',
          description: 'String to search for in logs. If service is also set, searches within that service only. If service is omitted, searches globally across all namespaces.',
        },
        exclude: {
          type: 'string',
          description: 'Regex pattern to exclude matching log lines, applied as LogQL !~ operator (e.g. "debug|trace").',
        },
        start: {
          type: 'string',
          description: 'Start of time range as ISO 8601 string (default: 15 minutes ago)',
        },
        end: {
          type: 'string',
          description: 'End of time range as ISO 8601 string (default: now)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of log lines to return (default: 100)',
          default: 100,
        },
      },
      required: ['environment'],
    },
  },
  {
    name: 'grafana_trace_id',
    description:
      'Traces a single Trace-Id (the x-trace-id header) across every service that took part in the request, and ' +
      'returns the reconstructed call chain: caller -> callee edges, per-call status codes and in-process ' +
      'durations, coverage gaps, and every error or warning logged under that id. ' +
      'Use this FIRST when investigating an issue for which a trace id is known — it replaces the manual ' +
      'grafana_search_logs narrowing loop with one call. ' +
      'Accepts the bare id, or any text containing one (a pasted log line, a URL, a stack trace). ' +
      'Naming the environment is dramatically faster: finding a trace is cheap, proving its absence is not. ' +
      'IMPORTANT when reading the result: `services.gaps` lists services that took part but emitted no request ' +
      'logs — a gap NEVER means the service was skipped, usually it has not adopted @tw/logger or runs below ' +
      'info level. `ambiguous: true` and `paired: false` mean the elapsed time is untrustworthy, not that the ' +
      'call did not happen. `found: false` with an unreachable probe is NOT proof of absence.',
    inputSchema: {
      type: 'object',
      properties: {
        trace_id: {
          type: 'string',
          description:
            'The trace id, or text containing it — a whole log line, a URL, a stack trace. Bare tokens are ' +
            'used verbatim: there is no trace id format, so ids like "01M0J6EYRY4TFEPR9PHJZ1QHPF" and ' +
            '"01M0J6EYRY4TFEPR9PHJZ1QHPF-page-3" are equally valid.',
        },
        environment: {
          type: 'string',
          description:
            'Search only this environment (e.g. "test", "staging", "prod"). Omit to search all configured ' +
            'environments in order, cheapest tier first — much slower when the trace is not found.',
        },
        start: { type: 'string', description: 'ISO 8601 start of the search window.' },
        end: { type: 'string', description: 'ISO 8601 end of the search window (default: now).' },
        lookback_hours: {
          type: 'number',
          description: 'Window size when `start` is omitted (default 48). Capped at 30 days — Loki rejects wider.',
        },
        output_file: {
          type: 'string',
          description:
            'Write the full Markdown report (Mermaid diagram, call tree, span table) to this path. The tool ' +
            'returns only a compact summary either way, so a large trace never floods the context window.',
        },
        limit: { type: 'number', description: 'Maximum log lines to fetch (default 5000).' },
      },
      required: ['trace_id'],
    },
  },
];
