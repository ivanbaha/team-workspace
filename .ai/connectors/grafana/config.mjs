/**
 * Grafana connector — shared config loader.
 * Reads credentials from .ai/connectors/env.json relative to the workspace root.
 *
 * Usage: imported by other grafana scripts.
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Walk up to workspace root (.ai/connectors/grafana → .ai/connectors → .ai → workspace root)
const ENV_PATH = resolve(__dirname, '../../env.json');

let _env = null;

export function loadEnv() {
  if (_env) return _env;
  try {
    _env = JSON.parse(readFileSync(ENV_PATH, 'utf8'));
  } catch (err) {
    process.stderr.write(
      `[grafana/config] ERROR: could not read env.json at ${ENV_PATH}\n` +
      `  Copy .ai/connectors/env.json.example → .ai/connectors/env.json and fill in your credentials.\n` +
      `  Original error: ${err.message}\n`
    );
    process.exit(1);
  }
  return _env;
}

export function getGrafanaConfig() {
  const env = loadEnv();
  if (!env.grafana || !env.grafana.environments) {
    process.stderr.write('[grafana/config] ERROR: env.json is missing "grafana.environments" key.\n');
    process.exit(1);
  }
  return env.grafana;
}

export function getEnvironment(envKey) {
  const config = getGrafanaConfig();
  const environment = config.environments[envKey];
  if (!environment) {
    const available = Object.keys(config.environments).join(', ');
    process.stderr.write(
      `[grafana/config] ERROR: Unknown environment key "${envKey}".\n` +
      `  Available: ${available}\n`
    );
    process.exit(1);
  }
  return environment;
}
