import { MongoDBAPI } from './api.js';
import { logger } from '../utils/logger.js';

const MAX_LIMIT = 200;

export class MongoDBTools {
  constructor(mongoConfig) {
    // mongoConfig: { [env]: { connectionString } }
    this.envConfig = mongoConfig;
    this.clients = {};
  }

  async initialize() {
    logger.info('Initialized MongoDB tools');
  }

  createResponse(success, data = null, message = '') {
    return { success, data, message };
  }

  _getApi(environment) {
    if (!this.envConfig[environment]) {
      const configured = Object.keys(this.envConfig);
      throw new Error(`Environment "${environment}" is not configured. Configured environments: ${configured.join(', ')}.`);
    }
    if (!this.clients[environment]) {
      this.clients[environment] = new MongoDBAPI(this.envConfig[environment].connectionString);
    }
    return this.clients[environment];
  }

  async getAvailable() {
    const envNames = Object.keys(this.envConfig);

    const results = await Promise.allSettled(
      envNames.map(async (env) => {
        const api = this._getApi(env);
        await api.ping();
        const databases = await api.listDatabases();
        return { env, databases: databases.map((d) => d.name) };
      })
    );

    const availability = {};
    for (let i = 0; i < envNames.length; i++) {
      const env = envNames[i];
      const result = results[i];
      if (result.status === 'fulfilled') {
        availability[env] = { available: true, databases: result.value.databases };
      } else {
        availability[env] = { available: false, error: result.reason?.message ?? 'Unknown error' };
      }
    }

    const availableCount = Object.values(availability).filter((e) => e.available).length;
    return this.createResponse(true, availability, `${availableCount}/${envNames.length} MongoDB environments available`);
  }

  async listCollections(environment, database) {
    try {
      const api = this._getApi(environment);
      const collections = await api.listCollections(database);
      return this.createResponse(true, collections, `${collections.length} collections in "${database}"`);
    } catch (error) {
      return this.createResponse(false, null, error.message);
    }
  }

  async find(environment, database, collection, { filter, projection, sort, limit = 20, skip = 0 } = {}) {
    try {
      const api = this._getApi(environment);
      const safeLimit = Math.min(limit, MAX_LIMIT);
      const docs = await api.find(database, collection, { filter, projection, sort, limit: safeLimit, skip });
      return this.createResponse(true, docs, `${docs.length} documents returned`);
    } catch (error) {
      return this.createResponse(false, null, error.message);
    }
  }

  async count(environment, database, collection, filter) {
    try {
      const api = this._getApi(environment);
      const total = await api.count(database, collection, filter);
      return this.createResponse(true, { count: total }, `${total} documents match the filter`);
    } catch (error) {
      return this.createResponse(false, null, error.message);
    }
  }

  async aggregate(environment, database, collection, pipeline) {
    try {
      const api = this._getApi(environment);
      const docs = await api.aggregate(database, collection, pipeline);
      return this.createResponse(true, docs, `${docs.length} documents returned`);
    } catch (error) {
      return this.createResponse(false, null, error.message);
    }
  }
}
