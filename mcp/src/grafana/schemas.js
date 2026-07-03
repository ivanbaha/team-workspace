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
];
