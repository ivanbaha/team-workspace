import { GrafanaAPI } from './api.js';
import { logqlString } from './trace/index.js';
import { logger } from '../utils/logger.js';

// Namespaces searched when no service is named. Varies by environment.
const GLOBAL_NAMESPACE_REGEX = {
  test: 'team-workspace-test',
  default: 'team-workspace',
};

function buildLogQLQuery(env, service, search, exclude) {
  let query;
  if (service && search) {
    // A plain `|=` line filter beats a regex match for a literal token such as a trace id.
    query = `{container="${service}"} |= ${logqlString(search)}`;
  } else if (service) {
    query = `{container="${service}"}`;
  } else {
    const ns = GLOBAL_NAMESPACE_REGEX[env] ?? GLOBAL_NAMESPACE_REGEX.default;
    query = `{namespace=~"${ns}"} |= ${logqlString(search)}`;
  }
  if (exclude) {
    // `exclude` is documented as a regex, so it stays a pattern — only the quoting is made safe.
    query += ` !~ ${logqlString(exclude)}`;
  }
  return query;
}

function toNanoSeconds(date) {
  return String(date.getTime()) + '000000';
}

function parseLogs(apiResponse) {
  const results = apiResponse?.data?.result ?? [];
  const lines = [];
  for (const stream of results) {
    for (const [, line] of stream.values) {
      lines.push(line);
    }
  }
  return lines;
}

export class GrafanaTools {
  constructor(grafanaConfig) {
    // grafanaConfig: { [env]: { pat, url } }
    this.envConfig = grafanaConfig;
    // Populated by grafana_get_available, used by future tools
    this.datasources = {};
  }

  async initialize() {
    logger.info('Initialized Grafana tools');
  }

  /** Namespace selector used when searching across services, e.g. for a trace id. */
  namespaceRegexFor(environment) {
    return GLOBAL_NAMESPACE_REGEX[environment] ?? GLOBAL_NAMESPACE_REGEX.default;
  }

  createResponse(success, data = null, message = '') {
    return { success, data, message };
  }

  async getAvailable() {
    const envNames = Object.keys(this.envConfig);

    const results = await Promise.allSettled(
      envNames.map(async (env) => {
        const { url, pat } = this.envConfig[env];
        const api = new GrafanaAPI(url, pat);
        const datasources = await api.getDatasources();
        const loki = datasources.find((ds) => ds.type === 'loki');
        return { env, loki };
      })
    );

    const availability = {};
    for (let i = 0; i < envNames.length; i++) {
      const env = envNames[i];
      const result = results[i];

      if (result.status === 'fulfilled') {
        const { loki } = result.value;
        if (loki) {
          this.datasources[env] = { uid: loki.uid, name: loki.name, url: loki.url };
        }
        availability[env] = { available: true };
      } else {
        availability[env] = { available: false, error: result.reason?.message ?? 'Unknown error' };
      }
    }

    const availableCount = Object.values(availability).filter((e) => e.available).length;
    return this.createResponse(
      true,
      availability,
      `${availableCount}/${envNames.length} Grafana environments available`
    );
  }

  async searchLogs(environment, { service, search, exclude, start, end, limit = 100 } = {}) {
    if (!environment) {
      return this.createResponse(false, null, '"environment" parameter is required.');
    }

    if (!service && !search) {
      return this.createResponse(false, null, 'At least one of "service" or "search" must be provided.');
    }

    if (Object.keys(this.datasources).length === 0) {
      return this.createResponse(false, null, 'No datasources available. Call grafana_get_available first to initialize Grafana connections.');
    }

    if (!this.envConfig[environment]) {
      const configured = Object.keys(this.envConfig);
      return this.createResponse(
        false,
        null,
        `Environment "${environment}" is not configured. Configured environments: ${configured.join(', ')}.`
      );
    }

    const datasource = this.datasources[environment];
    if (!datasource) {
      const available = Object.keys(this.datasources);
      return this.createResponse(
        false,
        null,
        `Environment "${environment}" is configured but has no Loki datasource — it may be unavailable. Available environments: ${available.join(', ')}.`
      );
    }

    const { url, pat } = this.envConfig[environment];
    const api = new GrafanaAPI(url, pat);

    const endDate = end ? new Date(end) : new Date();
    const startDate = start ? new Date(start) : new Date(endDate.getTime() - 15 * 60 * 1000);

    const query = buildLogQLQuery(environment, service, search, exclude);

    try {
      const response = await api.queryLoki(
        datasource.uid,
        query,
        toNanoSeconds(startDate),
        toNanoSeconds(endDate),
        limit
      );

      const logs = parseLogs(response);
      return this.createResponse(true, logs, `${logs.length} log lines returned`);
    } catch (error) {
      return this.createResponse(false, null, error.message);
    }
  }
}
