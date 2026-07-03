/**
 * Grafana connector — shared config loader.
 * Reads credentials from the root `.env` file first, falling back to `.ai/connectors/env.json`.
 *
 * Usage: imported by other grafana scripts.
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Paths relative to .ai/connectors/grafana
const ROOT_ENV_PATH = resolve(__dirname, '../../../.env');

let _env = null;

// Parse a standard dotenv file supporting multi-line quoted strings
function parseDotenv(filePath) {
  try {
    if (!existsSync(filePath)) return null;
    const content = readFileSync(filePath, 'utf8');
    const env = {};
    
    // Matches: KEY = 'value' (multi-line), KEY = "value" (multi-line), or KEY = value (single-line)
    const regex = /^\s*([\w.-]+)\s*=\s*(?:'([\s\S]*?)'|"([\s\S]*?)"|([^\r\n]*))/gm;
    
    let match;
    while ((match = regex.exec(content)) !== null) {
      const key = match[1];
      const val = match[2] !== undefined ? match[2] : (match[3] !== undefined ? match[3] : match[4]);
      if (val !== undefined) {
        env[key] = val.trim();
      }
    }
    return env;
  } catch (err) {
    process.stderr.write(`[grafana/config] WARNING: Failed to read .env file: ${err.message}\n`);
    return null;
  }
}

export function loadEnv() {
  if (_env) return _env;

  // Try to load from root .env first
  const dotenvVars = parseDotenv(ROOT_ENV_PATH);
  if (dotenvVars) {
    const gitlabBaseUrl = dotenvVars.GITLAB_BASE_URL || 'https://gitlab.company.internal/';
    const gitlabToken = dotenvVars.GITLAB_PAT || '';
    const jiraBaseUrl = dotenvVars.JIRA_BASE_URL || 'https://jira.company.internal';
    const jiraToken = dotenvVars.JIRA_PAT || '';
    const jiraEmail = dotenvVars.JIRA_EMAIL || '';
    const jiraDefaultProject = dotenvVars.JIRA_DEFAULT_PROJECT || 'TW';

    let grafanaEnvs = {};
    if (dotenvVars.GRAFANA_ENVS) {
      try {
        const parsed = JSON.parse(dotenvVars.GRAFANA_ENVS);
        // Map the MCP format {"test": {"pat": "...", "url": "..."}}
        // to connector format {"test": {"lokiUrl": "...", "username": "", "password": "..."}}
        for (const [key, val] of Object.entries(parsed)) {
          grafanaEnvs[key] = {
            lokiUrl: val.url || val.lokiUrl || '',
            username: val.username || '',
            password: val.pat || val.password || '',
            pat: val.pat || '',
          };
        }
      } catch (err) {
        process.stderr.write(`[grafana/config] WARNING: Failed to parse GRAFANA_ENVS JSON: ${err.message}\n`);
      }
    }

    let mongodbEnvs = {};
    if (dotenvVars.MONGODB_ENVS) {
      try {
        const parsed = JSON.parse(dotenvVars.MONGODB_ENVS);
        for (const [key, val] of Object.entries(parsed)) {
          mongodbEnvs[key] = {
            uri: val.connectionString || val.uri || '',
          };
        }
      } catch (err) {
        process.stderr.write(`[grafana/config] WARNING: Failed to parse MONGODB_ENVS JSON: ${err.message}\n`);
      }
    }

    _env = {
      grafana: { environments: grafanaEnvs },
      gitlab: { baseUrl: gitlabBaseUrl, token: gitlabToken },
      jira: { baseUrl: jiraBaseUrl, token: jiraToken, email: jiraEmail, defaultProject: jiraDefaultProject },
      mongodb: { environments: mongodbEnvs },
    };
    return _env;
  }

  // If we couldn't load the .env file, error out immediately
  process.stderr.write(
    `[grafana/config] ERROR: could not read .env at ${ROOT_ENV_PATH}\n` +
    `  Please configure a root .env file (see example.env at the workspace root).\n`
  );
  process.exit(1);
}

export function getGrafanaConfig() {
  const env = loadEnv();
  if (!env.grafana || !env.grafana.environments) {
    process.stderr.write('[grafana/config] ERROR: Config is missing "grafana.environments" key.\n');
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
