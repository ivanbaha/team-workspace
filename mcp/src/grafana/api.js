import { logger } from '../utils/logger.js';

export class GrafanaAPI {
  constructor(baseUrl, pat) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.pat = pat;
  }

  async request(endpoint) {
    const url = `${this.baseUrl}${endpoint}`;
    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.pat}`,
          Accept: 'application/json',
          'User-Agent': 'workspace-mcp-server',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      logger.error(`Grafana API request failed: ${url}`, error);
      throw error;
    }
  }

  async getDatasources() {
    return this.request('/api/datasources');
  }

  /**
   * Runs a Loki `query_range` through the Grafana datasource proxy.
   *
   * Going through the proxy rather than talking to Loki directly means the Grafana service-account
   * token is the only credential involved — there is no second set of Loki credentials to
   * distribute, rotate, or leak.
   *
   * @param {string} [direction] - 'forward' for chronological order (what trace assembly needs),
   *   'backward' for newest-first (what a log search wants).
   */
  async queryLoki(datasourceUid, query, start, end, limit, direction) {
    const params = new URLSearchParams({ query, start, end, limit: String(limit) });
    if (direction) params.set('direction', direction);
    return this.request(`/api/datasources/proxy/uid/${datasourceUid}/loki/api/v1/query_range?${params}`);
  }
}
