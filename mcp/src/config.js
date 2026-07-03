import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { logger } from './utils/logger.js';

const require = createRequire(import.meta.url);
const { loadEnvFile } = require('nestjs-env-getter/dist/shared/utils/env-parser');

const __dirname = dirname(fileURLToPath(import.meta.url));
const envFilePath = join(__dirname, '..', '..', '.env');

const GRAFANA_DEFAULT_URLS = {
  'test':       'https://grafana-test.company.internal/',
  'prod':       'https://grafana.company.internal/',
};

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`Required environment variable ${name} is not set. Check your .env file.`);
  }
  return value.trim();
}

function getOptionalEnv(name, defaultValue) {
  const value = process.env[name];
  return (value && value.trim() !== '') ? value.trim() : defaultValue;
}

function parseOptionalJsonEnv(name) {
  const raw = process.env[name];
  if (!raw || raw.trim() === '') return null;
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${name} is not valid JSON.`);
  }
}

function validateGrafanaEnvs(data) {
  if (typeof data !== 'object' || Array.isArray(data) || data === null) {
    throw new Error('GRAFANA_ENVS must be a JSON object.');
  }
  const result = {};
  for (const [env, value] of Object.entries(data)) {
    if (typeof value !== 'object' || Array.isArray(value) || value === null) {
      throw new Error(`GRAFANA_ENVS["${env}"] must be an object.`);
    }
    if (typeof value.pat !== 'string' || value.pat.trim() === '') {
      throw new Error(`GRAFANA_ENVS["${env}"].pat must be a non-empty string.`);
    }
    if (value.url !== undefined) {
      try { new URL(value.url); } catch {
        throw new Error(`GRAFANA_ENVS["${env}"].url is not a valid URL: "${value.url}".`);
      }
    }
    result[env] = {
      pat: value.pat.trim(),
      url: value.url || GRAFANA_DEFAULT_URLS[env] || null,
    };
  }
  return result;
}

function validateMongoDBEnvs(data) {
  if (typeof data !== 'object' || Array.isArray(data) || data === null) {
    throw new Error('MONGODB_ENVS must be a JSON object.');
  }
  const result = {};
  for (const [env, value] of Object.entries(data)) {
    if (typeof value !== 'object' || Array.isArray(value) || value === null) {
      throw new Error(`MONGODB_ENVS["${env}"] must be an object.`);
    }
    if (typeof value.connectionString !== 'string' || value.connectionString.trim() === '') {
      throw new Error(`MONGODB_ENVS["${env}"].connectionString must be a non-empty string.`);
    }
    result[env] = { connectionString: value.connectionString.trim() };
  }
  return result;
}

/**
 * Load configuration from workspace .env file using nestjs-env-getter parser
 */
export function loadConfig() {
  try {
    // Load .env file into process.env (system env vars take precedence)
    loadEnvFile(envFilePath);
    logger.info(`Loaded environment from ${envFilePath}`);

    const config = {
      gitlab: {
        baseUrl: getOptionalEnv('GITLAB_BASE_URL', 'https://gitlab.company.internal/'),
        pat: getRequiredEnv('GITLAB_PAT'),
      },
      jira: {
        baseUrl: getOptionalEnv('JIRA_BASE_URL', 'https://jira.company.internal'),
        pat: getRequiredEnv('JIRA_PAT'),
      },
      grafana: null,
      mongodb: null,
      docsSearch: {
        // Opt-in hybrid docs search (embeddings + Qdrant). Disabled by default
        // so users without the setup are unaffected; docs_map stays always-on.
        enabled: getOptionalEnv('DOCS_SEARCH_ENABLED', 'false') === 'true',
        qdrantUrl: getOptionalEnv('QDRANT_URL', 'http://127.0.0.1:6333'),
        qdrantEngine: getOptionalEnv('QDRANT_ENGINE', 'docker'),
      },
    };

    const grafanaData = parseOptionalJsonEnv('GRAFANA_ENVS');
    if (grafanaData) {
      config.grafana = validateGrafanaEnvs(grafanaData);
      logger.info(`Grafana configured for environments: ${Object.keys(config.grafana).join(', ')}`);
    }

    const mongodbData = parseOptionalJsonEnv('MONGODB_ENVS');
    if (mongodbData) {
      config.mongodb = validateMongoDBEnvs(mongodbData);
      logger.info(`MongoDB configured for environments: ${Object.keys(config.mongodb).join(', ')}`);
    }

    logger.info('Configuration loaded and validated successfully');
    return config;
  } catch (error) {
    logger.error('Failed to load configuration:', error.message);
    throw error;
  }
}
