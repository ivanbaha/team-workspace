#!/usr/bin/env node
/**
 * Grafana connector — list configured environments.
 *
 * Usage:
 *   node .ai/connectors/grafana/get-available.mjs
 *   node .ai/connectors/grafana/get-available.mjs --check   # also tests connectivity
 *
 * Output: JSON array of environment objects printed to stdout.
 * Errors: written to stderr.
 */

import { getGrafanaConfig } from './config.mjs';

const args = process.argv.slice(2);
const checkConnectivity = args.includes('--check');

const config = getGrafanaConfig();
const environments = config.environments;

if (!checkConnectivity) {
  // Fast path — just return the configured environment keys and their Loki URLs
  const result = Object.entries(environments).map(([key, cfg]) => ({
    key,
    lokiUrl: cfg.lokiUrl,
  }));
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exit(0);
}

// Connectivity check — make a lightweight HTTP request to each Grafana/Loki instance
async function checkEnv(key, cfg) {
  const url = `${cfg.lokiUrl}/loki/api/v1/labels`;
  const auth = Buffer.from(`${cfg.username}:${cfg.password}`).toString('base64');
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(5000),
    });
    return { key, lokiUrl: cfg.lokiUrl, status: res.ok ? 'ok' : `http_${res.status}` };
  } catch (err) {
    return { key, lokiUrl: cfg.lokiUrl, status: 'error', error: err.message };
  }
}

const results = await Promise.all(
  Object.entries(environments).map(([key, cfg]) => checkEnv(key, cfg))
);

process.stdout.write(JSON.stringify(results, null, 2) + '\n');
