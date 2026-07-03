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

  async queryLoki(datasourceUid, query, start, end, limit) {
    const params = new URLSearchParams({ query, start, end, limit: String(limit) });
    return this.request(`/api/datasources/proxy/uid/${datasourceUid}/loki/api/v1/query_range?${params}`);
  }
}
